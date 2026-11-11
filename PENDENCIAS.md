# Pendências (IaC, ambientes e segurança)

Atualizado em 2026-11-11. Plano original: IaC em CDK, ambientes staging/prod, configuração versionada e deploy seguro.

## Onde paramos

| Fase | Situação |
|---|---|
| 1. Configuração versionada e validada, migrations no pipeline | ✅ PR #13 |
| 2. Infra em CDK (staging e prod) | ✅ PRs #14 e #17; prod migrada sem queda |
| 3. Staging automático e promoção manual para prod (backend e front) | ✅ backend PRs #15 e #16; front PRs #15 e #16 |
| 4. Canary com rollback automático | ⏳ pendente |

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

## 2. Remover a infra antiga (depois de alguns dias estável)

Prod nova estável desde 2026-11-06, com deploys e promoção funcionando em 2026-11-11: dá para começar. Antes, conferir nas métricas que a distribuição `E3QT1JW59DWN5A` e a função `shift-swap-api` não recebem mais tráfego.

A prod antiga não serve mais tráfego (o alias foi movido em 2026-11-06). Ainda existem:

- **CloudFront:**
  - distribuição `E3QT1JW59DWN5A` (`dkrzib6ua831y.cloudfront.net`): desabilitar, esperar e excluir;
  - funções `shift-swap-api-prefix` e `shift-swap-spa-fallback`;
  - OAC `EAGK84APE4MJ1`.
- **Lambda Web Function:** `shift-swap-api`, com a role `shift-swap-api-web-role` e os log groups `/aws/lambda/web/shift-swap-api(.local)`.
- **S3:** buckets `shift-swap-api-web-666600766236` e `shift-swap-frontend-666600766236`.
- **IAM:** stack `shift-swap-github-actions` (roles `github-actions-shift-swap-backend` e `-frontend`) e o arquivo `infra/github-actions-roles.yaml`.
- **SSM:** `/shift-swap-api/DATABASE_URL` e `/shift-swap-api/BETTER_AUTH_SECRET` (os de prod agora estão em `/shift-swap-api/prod/`).
- **Documentação:** referências a `dkrzib6ua831y` no README e o `PUBLIC_URL`/descrições restantes.

## 3. Fase 4: canary com rollback automático

- **CDK:** alarmes do CloudWatch por ambiente (5xx e latência p95 da Web Function).
- **`deploy.yml`:** 10% para a revisão nova por cerca de 10 minutos, acompanhando os alarmes. Se tudo ficar ok, 100%; se algum alarme disparar, volta para a anterior e o job falha.
  - Pesos: `update-web-function-endpoint --revision-weights revisionId=<nova>,weight=10 revisionId=<atual>,weight=90`.
  - Só gravar o `live-revision` depois dos 100%.
- **Rollback manual:** `workflow_dispatch` recebendo o ID da revisão.
- **Teste:** forçar uma revisão quebrada em staging e ver o rollback.

## 4. Melhorias menores

- **Validação no cadastro:** corrigida na branch `fix/validacao-cadastro`. Nome e e-mail passam pelas regras do domínio no hook `before`; falhas devolvem `400` com `code` e `issues`, e nenhum usuário é criado. Antes, no Postgres (não no PGlite), a falha devolvia `500` e deixava o usuário do Better Auth sem o registro de funcionário. Conferido em 2026-11-11: nenhum usuário órfão em staging nem em prod.
- **`sslmode` da `DATABASE_URL`:** o `pg` avisa, nos dois ambientes, que `require` vai deixar de valer como `verify-full` no `pg` 9. Usar `sslmode=verify-full` antes de atualizar.
- **E-mails antigos com maiúsculas (opcional):** o shift-swap 0.7 normaliza na leitura, mas o banco só muda no próximo `update`. Para alinhar: `UPDATE funcionario SET email = lower(trim(email))` e o mesmo em `supervisor`.
- **Limite de tentativas burlável:** chamadas direto ao domínio da Web Function (`*.lambda-web...on.aws`), sem passar pelo CloudFront, conseguem forjar `CloudFront-Viewer-Address`. Fechar com um header secreto enviado pelo CloudFront (origin custom header) e validado pela API.
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
- **Permissões:** o Claude Code bloqueia, nesta máquina, merges, deploys de infra de prod e mudanças em IAM e segredos de prod. Esses comandos são rodados pelo usuário com `!`.
