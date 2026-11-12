# Pendências (IaC, ambientes e segurança)

Atualizado em 2026-11-12 (fases 1 a 4 concluídas). Plano original: IaC em CDK, ambientes staging/prod, configuração versionada e deploy seguro.

## Onde paramos

| Fase | Situação |
|---|---|
| 1. Configuração versionada e validada, migrations no pipeline | ✅ PR #13 |
| 2. Infra em CDK (staging e prod) | ✅ PRs #14 e #17; prod migrada sem queda |
| 3. Staging automático e promoção manual para prod (backend e front) | ✅ backend PRs #15 e #16; front PRs #15 e #16 |
| 4. Canary com rollback automático | ✅ PR #28; em prod desde 2026-11-12 |

**Estado atual:**

| Ambiente | URL | Stack | Web Function | Distribuição |
|---|---|---|---|---|
| staging | https://so-staging.mariochaves.click | `ShiftSwap-staging` | `shift-swap-api-staging` | `E5WA72XR2A1E` |
| prod | https://so.mariochaves.click | `ShiftSwap-prod` | `shift-swap-api-prod` | `E8JP6QYB4AC0S` |

**Fluxo:**
- Merge na `main` (backend) ou na `developer` (front) → staging.
- Actions → **"Promover para produção"** → prod, com o mesmo artefato.

**Dependências:** core-kernel 0.3.1 e shift-swap 0.7.1 em prod desde 2026-11-11 (PR #18), com o `core-kernel-check` como dev dependency.

## 1. Falha de segurança: qualquer um se cadastra como supervisor — ✅ concluído em 2026-11-11

`src/lib/auth.ts` declarava `role` com `input: true`: um `POST /api/auth/sign-up/email` com `"role": "SUPERVISOR"` criava um supervisor. Corrigido no backend (PR #19, em prod às 21:57 UTC) e no front (PR #17 do front, em prod às 22:15 UTC).

- Backend: `role` com `input: false` e `defaultValue: "EMPLOYEE"`, mais um hook `before` que força `EMPLOYEE`. Um `role` enviado no corpo é ignorado (sem erro).
- Front: sem o seletor de papel no cadastro; `role` com `input: false` no client.
- Promoção a supervisor fora da API: `bun run supervisor:promover <email>` (`:staging` e `:prod` para os ambientes da AWS, PR #20), também usada pelo seed. Recusa quem já tem turnos ou solicitações (apagar o funcionário levaria os turnos junto, por `ON DELETE CASCADE`).
- Rebaixamento para desfazer promoção por engano: `bun run supervisor:rebaixar <email>` (idem). Recusa supervisor com decisões no histórico e o último supervisor.
- Auditoria em prod: 3 supervisores, todos legítimos.
- Seed: a senha `password123` era recusada pelo `haveIBeenPwned` e o seed estava quebrado. Trocada por `turno-local-seed-2026`.

**Opcional:** `emailAndPassword.disableSignUp: true` se o cadastro passar a ser só por convite.

## 2. Remover a infra antiga — ✅ concluído em 2026-11-11

A prod antiga não recebia tráfego desde 2026-11-08. Removidos (PR #22 no repositório; na AWS, pelo usuário):

- Lambda Web Function `shift-swap-api` (endpoint, revisões, role `shift-swap-api-web-role` e log groups).
- CloudFront: distribuição `E3QT1JW59DWN5A` (`dkrzib6ua831y.cloudfront.net`), funções `shift-swap-api-prefix` e `shift-swap-spa-fallback`, OAC `EAGK84APE4MJ1`.
- S3: `shift-swap-api-web-666600766236` (com versões) e `shift-swap-frontend-666600766236`.
- IAM: stack `shift-swap-github-actions` (roles sem sufixo). O provedor OIDC do GitHub não fazia parte dela e continua em uso.
- SSM: `/shift-swap-api/DATABASE_URL` e `/shift-swap-api/BETTER_AUTH_SECRET`.

**Incidente fechado:** o endpoint da função antiga continuava público, com o código de 2026-11-06 (cadastro aceitando `role: SUPERVISOR`) e ligado ao banco de prod. Sem uso desde 2026-11-08; a auditoria depois da remoção encontrou só os 3 supervisores legítimos.

Ficou na AWS só o que é das stacks `ShiftSwap-staging` e `ShiftSwap-prod`, além dos recursos `hono-starter-*` (outro projeto).

## 3. Fase 4: canary com rollback automático — ✅ concluído em 2026-11-12

PR #28. A Web Function não publica latência nem separa métricas por revisão, então a API publica as próprias (EMF, `ShiftSwap/Api`, por `Environment` e `Environment`+`Version`). Fluxo e limites no README ("Deploy com canary").

- **Primeiro canary em staging:** `rev-aaadg`, 34 requisições, 0 com 5xx, p95 de 18 ms.
- **Teste de rollback em staging:** alarme de 5xx forçado durante o canary; o pipeline detectou em 28 s e voltou para a revisão anterior em 36 s; `live-revision` intacto.
- **Prod:** `rev-kvdei` (commit `3a31e76`), 160 requisições, 0 com 5xx, p95 de 10 ms; 100% às 18:45 UTC.

**Ajustes possíveis:**
- `canary.maxP95Ms` está em 2000 ms, contra cerca de 10 ms medidos. Calibrar depois de alguns dias de dados (o alarme `latencia-p95` está em 1500 ms).
- Os alarmes não têm ação. Um tópico SNS com e-mail avisaria fora do deploy.
- ~~Actions com Node 20~~: atualizadas para Node 24 em 2026-11-12 (`checkout@v7`, `upload-artifact@v7`, `download-artifact@v8`, `setup-node@v7`, `configure-aws-credentials@v6`; a `setup-bun@v2` já usava Node 24), no backend e no front.

## 4. Testes de integração e E2E — 🚧 backend na branch `test/integracao`; E2E do front pendente

Plano: integração no backend (`bun test`, API em processo) e E2E no front (Playwright contra a stack local no CI).

- **Backend:** 107 testes em `test/` (auth, permissões, turnos, funcionários, solicitações, expiração, scripts de supervisor, segredo de origem), ~10 s com PGlite em memória; no CI, contra o Postgres do job, antes do build.
- **Ajustes feitos para testar:** `AUTH_CHECK_PWNED` (desliga a consulta ao HaveIBeenPwned só nos testes; produção exige ligado), PGlite em memória (`pglite:memory://`), migrations como função (`src/db/migrate.ts`).
- **Bug corrigido:** `POST /turnos` com `funcionarioId` inexistente devolvia 500; agora 404 `FUNCIONARIO_NAO_ENCONTRADO`.
- **Decisão de produto em aberto:** criar ou editar um turno sobreposto a outro do mesmo funcionário é aceito; a sobreposição só é checada ao aceitar ou aprovar uma troca. O teste `turno sobreposto ... é aceito` (`test/turnos.test.ts`) registra o comportamento atual; se virar regra (409 `CONFLITO_DE_HORARIO`), muda junto.
- **Falta:** E2E no front (Playwright: cadastro/login, rotas protegidas, gestão de turnos, troca aprovada, troca recusada/rejeitada), com job no CI do front que sobe a API da `main` do backend.

## 5. Melhorias menores

- **Validação no cadastro:** ✅ em prod desde 2026-11-11 (PR #21). Nome e e-mail passam pelas regras do domínio no hook `before`; falhas devolvem `400` com `code` e `issues`, e nenhum usuário é criado. Antes, no Postgres (não no PGlite), a falha devolvia `500` e deixava o usuário do Better Auth sem o registro de funcionário. Conferido em 2026-11-11: nenhum usuário órfão em staging nem em prod.
- **`sslmode` da `DATABASE_URL`:** prod (SSM e `MIGRATIONS_DATABASE_URL`) já usava `verify-full`. Em 2026-11-11 staging passou a usar também: SSM, secret do Environment e `.env.staging.local`. Documentado no `infra/cdk/README.md`.
- **E-mails antigos com maiúsculas (opcional):** o shift-swap 0.7 normaliza na leitura, mas o banco só muda no próximo `update`. Para alinhar: `UPDATE funcionario SET email = lower(trim(email))` e o mesmo em `supervisor`.
- **Limite de tentativas burlável:** ✅ em prod desde 2026-11-12 (PR #25). O CloudFront envia o header `x-origin-verify` com o valor de `/shift-swap-api/<env>/ORIGIN_SECRET`, e a API recusa com `403` o que chega sem ele (exceto `/health`). Antes, chamadas direto ao domínio da Web Function (`*.lambda-web...on.aws`) conseguiam forjar `CloudFront-Viewer-Address`. Conferido nos dois ambientes: o endpoint direto devolve `403`, inclusive no login com o IP forjado, e pelo domínio público nada mudou. Rotação: ver "Segredo de origem" no `infra/cdk/README.md`.
- **Itens 4 a 6 da revisão do Better Auth:** captcha (Turnstile), verificação de e-mail, recuperação de senha e 2FA para supervisores.
- **Staging:** o branch do Neon é uma cópia dos dados de prod (decisão: manter). Os usuários de teste `teste-pipeline-1793991513@example.com` e `teste-role-1794431199@example.com` existem só em staging.
- **GitHub plano Free:** sem revisor obrigatório no Environment `production`. Assinar o plano Team permitiria trocar a promoção manual por aprovação.
- **Orçamento do Actions:** o orçamento da organização é US$ 0 com bloqueio, e a cota gratuita acabou em 2026-11-11. Backend e front passaram a ser públicos (minutos ilimitados). Se algum repositório voltar a ser privado, os jobs ficam na fila sem rodar.

## Lições aprendidas (Lambda Web Functions, CDK e CloudFormation)

- **Revisão de bootstrap:** o endpoint não pode ser criado sem revisão, então a stack cria um bootstrap que responde 503. Os pesos vêm do SSM `/shift-swap-api/<env>/live-revision`, gravado pelo pipeline. Sem isso, qualquer `cdk deploy` que mexesse no endpoint voltava o tráfego para o bootstrap.
- **Limites do endpoint:** `maxEnvironments` precisa ser ≥ 2, e `rateLimit` só aceita 0, 100, 200, …
- **Leitura do código:** o Lambda lê o zip com o principal `lambda.amazonaws.com` (o bucket precisa da policy `LambdaReadCode`), e o pacote precisa de `index.js` na raiz.
- **Acentos no template:** o CloudFormation guarda acentos como `??`. Mantenha descrições e o código das CloudFront Functions em ASCII, senão aparecem diffs fantasmas e o `cdk import` falha.
- **Import de `AWS::Route53::RecordSet`:** precisa de `Name`, `HostedZoneId`, `Type` e `SetIdentifier` (vazio para registros simples).
- **Mover um alias do CloudFront sem queda:** a distribuição de destino precisa ter um certificado que cubra o alias (usamos um alias temporário). Depois, TXT `_<alias>` e `update-domain-association`.
- **Rotas de auth atrás do CloudFront:** o front chama `/api/api/auth/*`. O CloudFront tira um `/api` e o app recebe `/api/auth/*`. Testar com um `/api` só dá 404 e parece defeito, mas não é.
- **Execuções presas na fila:** as execuções criadas durante o bloqueio de cobrança ficaram em `queued` para sempre. Não dá para cancelar nem rodar de novo (o GitHub as trata como encerradas). A saída é disparar outra com `gh workflow run ci-cd.yml --ref <branch>`.
- **`cdk deploy` com mudanças antigas:** o primeiro deploy depois do PR #25 também aplicou a limpeza de acentos (commit `964c1f8`) e recriou a revisão de bootstrap. Antes de rodar o `cdk deploy`, confira se o endpoint já está na revisão gravada em `live-revision`: assim a atualização do endpoint não muda o tráfego.
- **Commits sem código não rodam o pipeline:** o `ci-cd.yml` ignora `**.md`, `http/`, `openspec/`, `infra/` e `.env.example` (no front, só `**.md`). A promoção pega a última execução que passou por staging, então pular essas execuções não muda o que vai para prod. Se um dia a `main` exigir o check do CI para merge, um PR só de docs fica travado esperando um check que nunca roda.
- **Alarme forçado num teste:** um `set-alarm-state ALARM` pode ficar preso sem tráfego, porque o CloudWatch só reavalia com dados novos. Depois do teste, volte o alarme para `OK`; senão o próximo deploy para na checagem antes do canary.
- **`updateStatus` do endpoint:** logo depois de um `update-web-function-endpoint`, a API ainda pode mostrar o `Successful` da atualização anterior, e um endpoint recém-criado nem tem o campo. O `.github/scripts/pesos.sh` só aceita quando os pesos devolvidos são os pedidos.
- **`cdk deploy` com mudanças de IAM via `!`:** sem terminal interativo o CDK não consegue pedir confirmação e para sem mudar nada. Confira o diff de IAM e rode com `--require-approval never`.
- **Permissões:** o Claude Code bloqueia, nesta máquina, merges, deploys de infra de prod e mudanças em IAM e segredos de prod. Esses comandos são rodados pelo usuário com `!`.
