# Infra (AWS CDK)

Uma stack por ambiente (`ShiftSwap-staging`, `ShiftSwap-prod`), definida em [lib/shift-swap-stack.ts](lib/shift-swap-stack.ts) e parametrizada em [bin/app.ts](bin/app.ts):

| Recurso | Nome |
|---|---|
| Lambda Web Function + endpoints `default` e `teste` (smoke test da revisão nova antes do canary) | `shift-swap-api-<env>` |
| Alarmes do canary: taxa de 5xx (nativa) e latência p95 (EMF, `ShiftSwap/Api`) | `shift-swap-api-<env>-5xx`, `shift-swap-api-<env>-latencia-p95` |
| Role de execução (logs + `ssm:GetParameters` em `/shift-swap-api/<env>/*`) | `shift-swap-api-<env>-web-role` |
| Bucket do código da API (versionado) | `shift-swap-api-code-<env>-<conta>` |
| Bucket do front (privado, via OAC) | `shift-swap-frontend-<env>-<conta>` |
| CloudFront: front + `/api/*` no mesmo domínio, funções em [functions/](functions/) | `shift-swap <env>` |
| Route 53 A/AAAA (`dnsRecords`) | `so-staging.mariochaves.click` / `so.mariochaves.click` |
| Roles do GitHub Actions (só jobs com `environment: <env>`) | `github-actions-shift-swap-{backend,frontend}-<env>` |

## Quem cuida do quê

- **CDK:** tudo da tabela acima, inclusive limites do endpoint (`maxEnvironments`, `rateLimit`).
- **Pipeline:** revisões da Web Function (código + [config/env/&lt;env&gt;.json](../../config/env)) e para onde vai o tráfego.

O endpoint nasce apontando para uma **revisão de bootstrap** ([bootstrap-app/](bootstrap-app/), responde 503), porque a API não cria endpoint sem revisão. Depois de cada deploy o pipeline grava o ID da revisão no ar em `/shift-swap-api/<env>/live-revision`, e a stack lê esse parâmetro a cada `cdk deploy`. Assim mudar o endpoint pelo CDK não devolve o tráfego para o bootstrap (testado em staging).

**Não altere** a revisão de bootstrap nem os pesos do endpoint no código: os pesos vêm do parâmetro.

O endpoint `teste` nasce no bootstrap, e um `cdk deploy` o devolve para lá. Não tem importância: ele só recebe tráfego durante o deploy, quando o pipeline o aponta para a revisão nova.

Os alarmes não têm ação (SNS): servem ao canary do `deploy.yml`. Para receber avisos, crie um tópico e adicione `alarmActions`.

## Comandos

```bash
cd infra/cdk
bun install
AWS_PROFILE=mario npx cdk diff ShiftSwap-staging
AWS_PROFILE=mario npx cdk deploy ShiftSwap-staging
```

## Ambiente novo

1. Parâmetros no SSM (antes do primeiro `cdk deploy`):

   ```bash
   aws ssm put-parameter --type String --name /shift-swap-api/<env>/live-revision --value bootstrap
   aws ssm put-parameter --type SecureString --name /shift-swap-api/<env>/DATABASE_URL --value '<URL pooled>'
   aws ssm put-parameter --type SecureString --name /shift-swap-api/<env>/BETTER_AUTH_SECRET --value "$(openssl rand -base64 32)"
   aws ssm put-parameter --type String --name /shift-swap-api/<env>/ORIGIN_SECRET --value "$(openssl rand -hex 32)"
   ```

   Nas URLs do banco (aqui, no secret `MIGRATIONS_DATABASE_URL` do Environment e nos `.env.*.local`), use `sslmode=verify-full`. Com `require`, o `pg` avisa que o comportamento muda no `pg` 9: passa a criptografar sem verificar o certificado.

2. `npx cdk deploy ShiftSwap-<env>` e crie `config/env/<env>.json` com as saídas da stack.
3. Migrations com a URL **direta** do banco: `DATABASE_URL='<URL direta>' bun run migrate`.
4. Primeiro deploy da API (pipeline ou manual): revisão nova, `update-web-function-endpoint --revision-weights revisionId=<rev>,weight=100` e grave `<rev>` em `/shift-swap-api/<env>/live-revision`.

## Segredo de origem (`ORIGIN_SECRET`)

O endpoint da Web Function (`*.lambda-web...on.aws`) é público. Sem proteção, quem o chamasse direto conseguiria forjar `CloudFront-Viewer-Address` e escapar do limite de tentativas por IP. Por isso o CloudFront envia o header `x-origin-verify` (origin custom header) com o valor de `/shift-swap-api/<env>/ORIGIN_SECRET`, e a API recusa com `403` tudo que chega sem ele, exceto `/health` ([src/lib/origin-verify.ts](../../src/lib/origin-verify.ts)).

- **Tipo `String`, não `SecureString`:** a stack lê o valor por um parâmetro `AWS::SSM::Parameter::Value<String>`, que não aceita `SecureString`. O valor também aparece na configuração da distribuição, então a proteção real é o IAM da conta.
- **No Lambda é obrigatório:** `src/lambda.ts` não sobe sem o parâmetro (a revisão falha no smoke test e o pipeline faz rollback).
- **Ordem na primeira vez:** `put-parameter` → `cdk deploy` (o CloudFront passa a enviar o header, e a API antiga o ignora) → deploy da API.
- **Rotação:** `put-parameter --overwrite` com o valor novo, `cdk deploy` e logo em seguida um deploy da API (as instâncias leem o parâmetro ao iniciar). Entre o fim do `cdk deploy` e a revisão nova no ar, as chamadas à API recebem `403`. São alguns minutos, então faça a rotação fora do horário de uso.

## Limites que o CloudFormation valida

- `scalingConfig.maxEnvironments` ≥ 2.
- `throttleConfig.rateLimit` só aceita 0, 100, 200, …, 1000, 2000, …, 10000.
- O Lambda lê o código com o principal `lambda.amazonaws.com`: o bucket precisa da policy `LambdaReadCode`.
- O ponto de entrada do pacote precisa ser `index.js` na raiz do zip.

## Troca de domínio sem queda (prod antiga → `ShiftSwap-prod`)

Um alias só pode estar em uma distribuição, e o `update-domain-association` exige que a distribuição de destino já tenha um certificado que cubra o alias.

1. **Alias temporário:** `aliases: ["so-prod.mariochaves.click"]` e `npx cdk deploy ShiftSwap-prod`. A distribuição nova ganha o certificado curinga.
2. **Mover o alias:** um TXT `_so.mariochaves.click` com o domínio `*.cloudfront.net` da distribuição nova e depois:

   ```bash
   aws cloudfront update-domain-association --domain so.mariochaves.click \
     --target-resource DistributionId=<distribuição nova> --if-match <ETag da distribuição nova>
   ```

   O alias muda de distribuição numa operação atômica. O tráfego já vai para a distribuição nova mesmo com o DNS antigo, porque o CloudFront roteia pelo domínio da requisição.
3. **DNS:** UPSERT dos registros A/AAAA de `so.mariochaves.click` para a distribuição nova (troca atômica, sem janela sem DNS). Em seguida, `dnsRecords` ganha `{ id: "Alias", name: "so.mariochaves.click" }` e `npx cdk import ShiftSwap-prod` traz os registros para a stack.
4. **Limpeza:** `aliases: ["so.mariochaves.click"]`, sem o `TempAlias` em `dnsRecords`, `npx cdk deploy ShiftSwap-prod` e remoção do TXT.
