import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import type { Construct } from "constructs";

export interface ShiftSwapEnvironment {
  /** Nome curto do ambiente, usado nos nomes dos recursos ("staging", "prod"). */
  name: string;
  /** GitHub Environment cujos jobs podem assumir as roles de deploy ("staging", "production"). */
  githubEnvironment: string;
  /** Domínio público (front + /api). */
  domainName: string;
  /**
   * Associa o domínio à distribuição e cria os registros no Route 53. Na prod nova fica false até a
   * troca: o alias ainda está na distribuição antiga e um alias só pode estar em uma distribuição.
   */
  attachDomain: boolean;
  /** Limites do endpoint da Web Function. */
  maxEnvironments: number;
  rateLimit: number;
}

export interface ShiftSwapStackProps extends cdk.StackProps {
  environment: ShiftSwapEnvironment;
  /** Certificado ACM (us-east-1) que cobre o domínio; hoje o curinga *.mariochaves.click. */
  certificateArn: string;
  hostedZoneId: string;
  hostedZoneName: string;
  /** Prefixos do "sub" imutável do OIDC do GitHub (ver PR #10). */
  backendSubPrefix: string;
  frontendSubPrefix: string;
}

const functionCode = (file: string) =>
  cloudfront.FunctionCode.fromFile({ filePath: fileURLToPath(new URL(`../functions/${file}`, import.meta.url)) });

/**
 * Um ambiente completo do shift-swap: API (Lambda Web Function), front (S3), CloudFront servindo os
 * dois no mesmo domínio, DNS e as roles que o GitHub Actions assume para publicar.
 *
 * As revisões da Web Function e os pesos do endpoint NÃO são gerenciados aqui: o pipeline cria uma
 * revisão por deploy (código + config/env/<ambiente>.json) e decide para onde vai o tráfego.
 */
export class ShiftSwapStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ShiftSwapStackProps) {
    super(scope, id, props);

    const env = props.environment;
    const functionName = `shift-swap-api-${env.name}`;
    const ssmPrefix = `/shift-swap-api/${env.name}/`;

    // --- API -----------------------------------------------------------------------------------

    const webFunction = new lambda.CfnWebFunction(this, "WebFunction", { functionName });

    const logGroups = [functionName, `${functionName}.local`].map(
      (name) =>
        new logs.LogGroup(this, `Logs${name.endsWith(".local") ? "Local" : ""}`, {
          logGroupName: `/aws/lambda/web/${name}`,
          retention: logs.RetentionDays.TWO_WEEKS,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
    );

    const executionRole = new iam.Role(this, "ExecutionRole", {
      roleName: `${functionName}-web-role`,
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: `Execução da Web Function ${functionName}`,
    });
    for (const group of logGroups) {
      group.grantWrite(executionRole);
    }
    // Só os segredos deste ambiente (DATABASE_URL e BETTER_AUTH_SECRET, carregados por src/lambda.ts).
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameters"],
        resources: [`arn:${this.partition}:ssm:${this.region}:${this.account}:parameter${ssmPrefix}*`],
      }),
    );

    // O endpoint só pode ser criado apontando para uma revisão. Esta (bootstrap-app/) responde 503
    // em tudo até o pipeline publicar a primeira revisão real e mover o tráfego para ela.
    // NÃO altere esta revisão nem os pesos do endpoint aqui: uma substituição faria o CloudFormation
    // mandar o tráfego de volta para o bootstrap. Revisões e pesos são do pipeline.
    const codeBucket = new s3.Bucket(this, "CodeBucket", {
      bucketName: `shift-swap-api-code-${env.name}-${this.account}`,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      // As revisões apontam para uma versão do objeto: mantenha as antigas por um tempo para rollback.
      lifecycleRules: [{ noncurrentVersionExpiration: cdk.Duration.days(60) }],
    });
    // A Web Function lê o código com o principal de serviço do Lambda, não com quem cria a revisão.
    codeBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "LambdaReadCode",
        principals: [new iam.ServicePrincipal("lambda.amazonaws.com")],
        actions: ["s3:GetObject", "s3:GetObjectVersion"],
        resources: [codeBucket.arnForObjects("*")],
        conditions: { StringEquals: { "aws:SourceAccount": this.account } },
      }),
    );

    const bootstrapCode = new s3deploy.BucketDeployment(this, "BootstrapCode", {
      sources: [s3deploy.Source.asset(fileURLToPath(new URL("../bootstrap-app", import.meta.url)))],
      destinationBucket: codeBucket,
      destinationKeyPrefix: "bootstrap/",
      // Mantém o zip (a revisão aponta para ele) em vez de extrair os arquivos.
      extract: false,
      prune: false,
    });
    const bootstrapRevision = new lambda.CfnWebFunctionRevision(this, "BootstrapRevision", {
      // O ARN (e não o nome) cria a dependência: a revisão só é criada depois da função.
      functionName: webFunction.attrFunctionArn,
      description: "bootstrap (503 até o primeiro deploy)",
      buildConfig: {
        codeConfig: { s3Object: { bucket: codeBucket.bucketName, key: cdk.Fn.join("", ["bootstrap/", cdk.Fn.select(0, bootstrapCode.objectKeys)]) } },
        runtimeConfig: { runtime: "nodejs24.x" },
      },
      serviceConfig: { executionRoleArn: executionRole.roleArn, timeoutSeconds: 10 },
    });
    // A policy do bucket precisa existir antes: sem ela o Lambda não consegue ler o zip.
    bootstrapRevision.node.addDependency(executionRole, bootstrapCode, codeBucket.policy!);

    // Qualquer update do endpoint pelo CloudFormation reenvia os pesos do template. Para não mandar o
    // tráfego de volta ao bootstrap, o template usa a revisão que está no ar: o pipeline grava o ID em
    // `${liveRevisionParam}` depois de cada deploy, e o CloudFormation lê o valor a cada `cdk deploy`.
    // Com o valor "bootstrap" (ambiente novo) o endpoint aponta para a revisão de bootstrap.
    // O parâmetro precisa existir antes do primeiro deploy da stack (ver infra/cdk/README.md).
    const liveRevisionParam = `${ssmPrefix}live-revision`;
    const liveRevision = new cdk.CfnParameter(this, "LiveRevision", {
      type: "AWS::SSM::Parameter::Value<String>",
      default: liveRevisionParam,
      description: "Parâmetro do SSM com o ID da revisão no ar (gravado pelo pipeline)",
    });
    const isBootstrap = new cdk.CfnCondition(this, "IsBootstrap", {
      expression: cdk.Fn.conditionEquals(liveRevision.valueAsString, "bootstrap"),
    });

    const endpoint = new lambda.CfnWebFunctionEndpoint(this, "Endpoint", {
      functionName: webFunction.attrFunctionArn,
      endpointName: "default",
      endpointType: "HomeRegion",
      // Público: a autenticação é feita pela aplicação (Better Auth).
      authType: "ApplicationManaged",
      revisionWeights: [
        {
          revisionId: cdk.Fn.conditionIf(
            isBootstrap.logicalId,
            bootstrapRevision.attrRevisionId,
            liveRevision.valueAsString,
          ).toString(),
          weight: 100,
        },
      ],
      scalingConfig: { maxEnvironments: env.maxEnvironments },
      throttleConfig: { rateLimit: env.rateLimit },
    });


    // --- Front ---------------------------------------------------------------------------------

    const frontendBucket = new s3.Bucket(this, "FrontendBucket", {
      bucketName: `shift-swap-frontend-${env.name}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // --- CloudFront: front e /api/* no mesmo domínio --------------------------------------------

    const spaFallback = new cloudfront.Function(this, "SpaFallback", {
      functionName: `shift-swap-${env.name}-spa-fallback`,
      code: functionCode("spa-fallback.js"),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });
    const apiPrefix = new cloudfront.Function(this, "ApiPrefix", {
      functionName: `shift-swap-${env.name}-api-prefix`,
      code: functionCode("api-prefix.js"),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: `shift-swap ${env.name}`,
      defaultRootObject: "index.html",
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      ...(env.attachDomain && {
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        domainNames: [env.domainName],
        certificate: acm.Certificate.fromCertificateArn(this, "Certificate", props.certificateArn),
      }),
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [{ function: spaFallback, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        "/api/*": {
          origin: new origins.HttpOrigin(endpoint.attrDomainName, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // Sem o Host (a Web Function espera o próprio domínio) e com CloudFront-Viewer-Address,
          // de onde src/lib/client-ip.ts tira o IP do visitante para o limite de tentativas.
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: [{ function: apiPrefix, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
        },
      },
    });

    if (env.attachDomain) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.hostedZoneName,
      });
      const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution));
      new route53.ARecord(this, "AliasA", { zone, recordName: env.domainName, target });
      new route53.AaaaRecord(this, "AliasAAAA", { zone, recordName: env.domainName, target });
    }

    // --- Roles do GitHub Actions (OIDC) ---------------------------------------------------------

    const githubProvider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      "GitHubOidc",
      `arn:${this.partition}:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
    );
    // Só jobs que declaram `environment: <githubEnvironment>` assumem a role. Em `production` o
    // GitHub exige aprovação antes do job rodar, então nem um push direto chega à prod sem ela.
    const githubPrincipal = (subPrefix: string) =>
      new iam.WebIdentityPrincipal(githubProvider.openIdConnectProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": `${subPrefix}:environment:${env.githubEnvironment}`,
        },
      });

    const functionArn = `arn:${this.partition}:lambda:${this.region}:${this.account}:web-function/${functionName}`;

    const backendDeployRole = new iam.Role(this, "BackendDeployRole", {
      roleName: `github-actions-shift-swap-backend-${env.name}`,
      description: `Deploy da API (${env.name}) pelo GitHub Actions`,
      assumedBy: githubPrincipal(props.backendSubPrefix),
      maxSessionDuration: cdk.Duration.hours(1),
    });
    backendDeployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "lambda:GetWebFunction",
          "lambda:GetWebFunctionEndpoint",
          "lambda:ListWebFunctionEndpoints",
          "lambda:GetWebFunctionRevision",
          "lambda:ListWebFunctionRevisions",
          "lambda:CreateWebFunctionRevision",
          // O pipeline define os pesos do endpoint (deploy direto, canary e rollback).
          "lambda:UpdateWebFunctionEndpoint",
        ],
        resources: [functionArn, `${functionArn}/*`],
      }),
    );
    backendDeployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter", "ssm:PutParameter"],
        resources: [`arn:${this.partition}:ssm:${this.region}:${this.account}:parameter${liveRevisionParam}`],
      }),
    );
    codeBucket.grantReadWrite(backendDeployRole);
    executionRole.grantPassRole(backendDeployRole);

    const frontendDeployRole = new iam.Role(this, "FrontendDeployRole", {
      roleName: `github-actions-shift-swap-frontend-${env.name}`,
      description: `Deploy do front (${env.name}) pelo GitHub Actions`,
      assumedBy: githubPrincipal(props.frontendSubPrefix),
      maxSessionDuration: cdk.Duration.hours(1),
    });
    frontendBucket.grantReadWrite(frontendDeployRole);
    frontendBucket.grantDelete(frontendDeployRole);

    // --- Saídas usadas em config/env/<ambiente>.json e nos workflows ---------------------------

    const outputs: Record<string, string> = {
      FunctionName: functionName,
      EndpointDomainName: endpoint.attrDomainName,
      ExecutionRoleArn: executionRole.roleArn,
      SsmPrefix: ssmPrefix,
      LiveRevisionParameter: liveRevisionParam,
      CodeBucket: codeBucket.bucketName,
      FrontendBucket: frontendBucket.bucketName,
      DistributionId: distribution.distributionId,
      DistributionDomainName: distribution.distributionDomainName,
      PublicUrl: env.attachDomain ? `https://${env.domainName}` : `https://${distribution.distributionDomainName}`,
      BackendDeployRoleArn: backendDeployRole.roleArn,
      FrontendDeployRoleArn: frontendDeployRole.roleArn,
    };
    for (const [key, value] of Object.entries(outputs)) {
      new cdk.CfnOutput(this, `Out${key}`, { key, value });
    }

    cdk.Tags.of(this).add("project", "shift-swap");
    cdk.Tags.of(this).add("environment", env.name);
  }
}
