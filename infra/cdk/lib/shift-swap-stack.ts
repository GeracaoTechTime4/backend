import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
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
  /** Domínio público canônico (front + /api), usado na saída PublicUrl. */
  domainName: string;
  /** Domínios associados à distribuição (precisam estar cobertos pelo certificado). */
  aliases: string[];
  /**
   * Registros A/AAAA no Route 53 apontando para a distribuição. O `id` é o prefixo dos IDs lógicos
   * (`<id>A`/`<id>AAAA`): mantenha-o estável, ou o CloudFormation recria o registro.
   */
  dnsRecords: { id: string; name: string }[];
  /** Limites do endpoint da Web Function. */
  maxEnvironments: number;
  rateLimit: number;
  /** Limite do alarme de latência p95 da API, em ms (métrica EMF de src/lib/metricas.ts). */
  latencyP95AlarmMs: number;
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

    // Textos que vão para o template (descrições, código das CloudFront Functions) só em ASCII: o
    // CloudFormation guarda acentos como "??", e o CDK passa a ver mudanças que não existem (o que
    // também impede `cdk import`).
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
      description: `Execucao da Web Function ${functionName}`,
    });
    for (const group of logGroups) {
      group.grantWrite(executionRole);
    }
    // Só os segredos deste ambiente (DATABASE_URL, BETTER_AUTH_SECRET e ORIGIN_SECRET, carregados por src/lambda.ts).
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
      description: "bootstrap (503 ate o primeiro deploy)",
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
    // Header secreto que o CloudFront envia para a API; a API carrega o mesmo parametro (src/lambda.ts).
    // Parametro do tipo SSM (e nao {{resolve:ssm:...}}): o CloudFormation rele o valor a cada deploy,
    // entao uma rotacao e `put-parameter` + `cdk deploy`. Precisa existir antes do deploy da stack.
    const originSecret = new cdk.CfnParameter(this, "OriginSecret", {
      type: "AWS::SSM::Parameter::Value<String>",
      default: `${ssmPrefix}ORIGIN_SECRET`,
      description: "Parametro do SSM com o header secreto entre o CloudFront e a API",
    });
    const liveRevision = new cdk.CfnParameter(this, "LiveRevision", {
      type: "AWS::SSM::Parameter::Value<String>",
      default: liveRevisionParam,
      description: "Parametro do SSM com o ID da revisao no ar (gravado pelo pipeline)",
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

    // Endpoint de teste: o pipeline aponta a revisao nova para ele e roda o smoke test ANTES de a
    // revisao receber trafego de verdade. Fora do deploy nao recebe nada. Os pesos sao do pipeline
    // (um `cdk deploy` volta este endpoint para o bootstrap, sem efeito para os usuarios).
    // Exige o header x-origin-verify como o endpoint principal (o pipeline le o segredo no SSM).
    const testEndpointName = "teste";
    const testEndpoint = new lambda.CfnWebFunctionEndpoint(this, "TestEndpoint", {
      functionName: webFunction.attrFunctionArn,
      endpointName: testEndpointName,
      endpointType: "HomeRegion",
      authType: "ApplicationManaged",
      revisionWeights: [{ revisionId: bootstrapRevision.attrRevisionId, weight: 100 }],
      scalingConfig: { maxEnvironments: 2 },
      throttleConfig: { rateLimit: 100 },
    });

    // --- Alarmes (o canary do deploy.yml acompanha os dois) -----------------------------------

    // Taxa de 5xx do endpoint principal, pela metrica nativa: ela conta tambem os 5xx que o Lambda
    // devolve quando a revisao nem chega a responder (o EMF da aplicacao nao ve esses). Com menos de
    // 10 requisicoes no minuto a taxa e tratada como 0, para um erro isolado nao disparar o alarme.
    const nativeMetric = (metricName: string) =>
      new cloudwatch.Metric({
        namespace: "AWS/Lambda/Web",
        metricName,
        dimensionsMap: { FunctionName: functionName, EndpointName: "default" },
        statistic: "Sum",
        period: cdk.Duration.minutes(1),
      });
    const errorRateAlarm = new cloudwatch.Alarm(this, "ErrorRateAlarm", {
      alarmName: `${functionName}-5xx`,
      alarmDescription: `Taxa de 5xx da API (${env.name}) acima de 5% (minimo de 10 requisicoes no minuto)`,
      metric: new cloudwatch.MathExpression({
        expression: "IF(req >= 10, 100 * FILL(e5xx, 0) / req, 0)",
        usingMetrics: { e5xx: nativeMetric("HTTPResponseStatusClass5XX"), req: nativeMetric("ExecutedRequests") },
        period: cdk.Duration.minutes(1),
        label: "Taxa de 5xx (%)",
      }),
      threshold: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Latencia p95 de todas as revisoes do ambiente (metrica EMF; a Web Function nao publica latencia).
    const latencyAlarm = new cloudwatch.Alarm(this, "LatencyAlarm", {
      alarmName: `${functionName}-latencia-p95`,
      alarmDescription: `Latencia p95 da API (${env.name}) acima de ${env.latencyP95AlarmMs} ms em 2 de 3 minutos`,
      metric: new cloudwatch.Metric({
        namespace: "ShiftSwap/Api",
        metricName: "Latency",
        dimensionsMap: { Environment: env.name },
        statistic: "p95",
        period: cdk.Duration.minutes(1),
      }),
      threshold: env.latencyP95AlarmMs,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
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
      ...(env.aliases.length > 0 && {
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        domainNames: env.aliases,
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
            // A API recusa requisicoes sem este header (src/lib/origin-verify.ts), o que fecha o
            // acesso direto ao endpoint. O valor fica no SSM como String: parametros do tipo SSM nao
            // aceitam SecureString. Ver "Segredo de origem" em infra/cdk/README.md.
            customHeaders: { "x-origin-verify": originSecret.valueAsString },
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

    if (env.dnsRecords.length > 0) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.hostedZoneName,
      });
      const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution));
      for (const record of env.dnsRecords) {
        new route53.ARecord(this, `${record.id}A`, { zone, recordName: record.name, target });
        new route53.AaaaRecord(this, `${record.id}AAAA`, { zone, recordName: record.name, target });
      }
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
    // Smoke test no endpoint de teste: precisa do mesmo header que o CloudFront envia.
    backendDeployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [`arn:${this.partition}:ssm:${this.region}:${this.account}:parameter${ssmPrefix}ORIGIN_SECRET`],
      }),
    );
    // Canary: estado dos alarmes e metricas da revisao nova (GetMetricData nao aceita restricao por recurso).
    backendDeployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudwatch:DescribeAlarms"],
        resources: [errorRateAlarm.alarmArn, latencyAlarm.alarmArn],
      }),
    );
    backendDeployRole.addToPolicy(new iam.PolicyStatement({ actions: ["cloudwatch:GetMetricData"], resources: ["*"] }));
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
      TestEndpointName: testEndpointName,
      TestEndpointDomainName: testEndpoint.attrDomainName,
      ErrorRateAlarmName: errorRateAlarm.alarmName,
      LatencyAlarmName: latencyAlarm.alarmName,
      ExecutionRoleArn: executionRole.roleArn,
      SsmPrefix: ssmPrefix,
      LiveRevisionParameter: liveRevisionParam,
      CodeBucket: codeBucket.bucketName,
      FrontendBucket: frontendBucket.bucketName,
      DistributionId: distribution.distributionId,
      DistributionDomainName: distribution.distributionDomainName,
      PublicUrl: env.aliases.includes(env.domainName)
        ? `https://${env.domainName}`
        : `https://${distribution.distributionDomainName}`,
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
