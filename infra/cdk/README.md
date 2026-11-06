# Infra (AWS CDK)

Uma stack por ambiente (`ShiftSwap-staging`, `ShiftSwap-prod`), definida em [lib/shift-swap-stack.ts](lib/shift-swap-stack.ts) e parametrizada em [bin/app.ts](bin/app.ts):

| Recurso | Nome |
|---|---|
| Lambda Web Function + endpoint `default` | `shift-swap-api-<env>` |
| Role de execução (logs + `ssm:GetParameters` em `/shift-swap-api/<env>/*`) | `shift-swap-api-<env>-web-role` |
| Bucket do código da API (versionado) | `shift-swap-api-code-<env>-<conta>` |
| Bucket do front (privado, via OAC) | `shift-swap-frontend-<env>-<conta>` |
| CloudFront: front + `/api/*` no mesmo domínio, funções em [functions/](functions/) | `shift-swap <env>` |
| Route 53 A/AAAA (quando `attachDomain`) | `so-staging.mariochaves.click` / `so.mariochaves.click` |
| Roles do GitHub Actions (só jobs com `environment: <env>`) | `github-actions-shift-swap-{backend,frontend}-<env>` |

## Quem cuida do quê

- **CDK:** tudo da tabela acima, inclusive limites do endpoint (`maxEnvironments`, `rateLimit`).
- **Pipeline:** revisões da Web Function (código + [config/env/&lt;env&gt;.json](../../config/env)) e para onde vai o tráfego.

O endpoint nasce apontando para uma **revisão de bootstrap** ([bootstrap-app/](bootstrap-app/), responde 503), porque a API não cria endpoint sem revisão. Depois de cada deploy o pipeline grava o ID da revisão no ar em `/shift-swap-api/<env>/live-revision`, e a stack lê esse parâmetro a cada `cdk deploy`. Assim mudar o endpoint pelo CDK não devolve o tráfego para o bootstrap (testado em staging).

**Não altere** a revisão de bootstrap nem os pesos do endpoint no código: os pesos vêm do parâmetro.

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
   ```

2. `npx cdk deploy ShiftSwap-<env>` e crie `config/env/<env>.json` com as saídas da stack.
3. Migrations com a URL **direta** do banco: `DATABASE_URL='<URL direta>' bun run migrate`.
4. Primeiro deploy da API (pipeline ou manual): revisão nova, `update-web-function-endpoint --revision-weights revisionId=<rev>,weight=100` e grave `<rev>` em `/shift-swap-api/<env>/live-revision`.

## Limites que o CloudFormation valida

- `scalingConfig.maxEnvironments` ≥ 2.
- `throttleConfig.rateLimit` só aceita 0, 100, 200, …, 1000, 2000, …, 10000.
- O Lambda lê o código com o principal `lambda.amazonaws.com`: o bucket precisa da policy `LambdaReadCode`.
- O ponto de entrada do pacote precisa ser `index.js` na raiz do zip.
