# shift-swap-api

API de troca de plantões com autenticação via [Better Auth](https://www.better-auth.com), Postgres e suporte a dois tipos de usuário: `SUPERVISOR` e `EMPLOYEE`.

## Desenvolvimento local

1. Instale as dependências:

   ```bash
   bun install
   ```

2. Copie o arquivo de variáveis de ambiente e ajuste os valores (gere `BETTER_AUTH_SECRET` com `openssl rand -base64 32`):

   ```bash
   cp .env.example .env
   ```

3. Escolha o banco:

   - **Sem Docker (padrão):** deixe `DATABASE_URL` vazia (ou `pglite:./.data/pglite`) no `.env`. A API usa o [PGlite](https://pglite.dev), um Postgres embutido que grava em `./.data/` — nada para instalar nem subir. Para zerar o banco, apague essa pasta.
   - **Com Postgres:** defina `DATABASE_URL=postgresql://shift_swap:shift_swap@localhost:5432/shift_swap` e suba só o Postgres (ou use um já existente):

     ```bash
     docker compose up -d postgres
     ```

   O schema é o mesmo nos dois (`src/db/schema.sql`). O PGlite é só para desenvolvimento; produção e o `docker compose` usam Postgres.

4. Aplique o schema do Better Auth e o schema de domínio (tabelas `funcionario`/`supervisor`) no banco:

   ```bash
   bun run migrate
   ```

5. (Opcional) Popule o banco com dados de teste — 1 supervisor, 2 funcionários e alguns turnos:

   ```bash
   bun run seed
   ```

   O script imprime as credenciais criadas (senha `turno-local-seed-2026` para todos). É idempotente: rodar de novo reaproveita os usuários já existentes em vez de duplicar.

6. Rode a API:

   ```bash
   bun run dev
   ```

A API sobe em `http://localhost:3000`.

## Docker

Para rodar tudo (API + Postgres) via Docker:

```bash
export BETTER_AUTH_SECRET=$(openssl rand -base64 32)
docker compose up --build
```

O container da API roda as migrations (Better Auth + domínio) automaticamente antes de iniciar o servidor. Pra popular com dados de teste depois que os containers estiverem de pé:

```bash
docker compose exec api bun run seed
```

## Deploy na AWS (Lambda Web Functions)

Em produção a API roda no [AWS Lambda Web Functions](https://docs.aws.amazon.com/lambda/) (Node.js 24, escala a zero, cobra só CPU ativo) com um Postgres gerenciado gratuito fora da AWS (Neon ou Supabase) acessado por TLS. Sem VPC nem NAT Gateway, o custo fica perto de zero com pouco tráfego.

O `bun run build` gera um bundle único em `deploy/index.js` a partir de [src/lambda.ts](src/lambda.ts), que carrega `DATABASE_URL` e `BETTER_AUTH_SECRET` do SSM Parameter Store (quando `SSM_PREFIX` está definido) e então importa a API. Localmente o Bun continua sendo usado para `dev`, `migrate` e `seed`. O bundle sempre roda como produção: sem um `DATABASE_URL` Postgres ele não sobe (o PGlite não serve no Lambda, porque o disco é efêmero e cada instância teria o seu).

Cada ambiente (staging e prod) é uma stack do CDK, com a Web Function, o endpoint, o CloudFront (front e `/api/*` no mesmo domínio), os buckets e as roles. A criação de um ambiente, os segredos no SSM (`/shift-swap-api/<ambiente>/`) e o primeiro deploy estão em [infra/cdk/README.md](infra/cdk/README.md). Depois disso, os deploys saem pelo GitHub Actions (veja "CI/CD" abaixo).

Banco: Postgres no Neon (o de staging é um branch do banco de prod). A API usa a URL **pooled** (segredo `DATABASE_URL` no SSM) e as migrations usam a URL **direta** (secret `MIGRATIONS_DATABASE_URL` do GitHub Environment).

Para limitar custos, a stack define `scalingConfig.maxEnvironments` e `throttleConfig.rateLimit` no endpoint e retenção curta nos logs do CloudWatch. Vale ter um alerta no AWS Budgets.

## Infra como código

A infra de staging e prod é definida em AWS CDK: veja [infra/cdk/README.md](infra/cdk/README.md). Staging: `https://so-staging.mariochaves.click`; prod: `https://so.mariochaves.click`.

## CI/CD (GitHub Actions)

| Gatilho | Workflow | O que roda |
|---|---|---|
| Todo PR e push | [ci-cd.yml](.github/workflows/ci-cd.yml) | `tsc --noEmit`, `bun run build`, smoke test do bundle no Node 24 contra um Postgres de verdade, bundle recusando configuração inválida e validação de `config/env/*.json` |
| Push na `main` | [ci-cd.yml](.github/workflows/ci-cd.yml) → [deploy.yml](.github/workflows/deploy.yml) | Deploy em **staging** (`https://so-staging.mariochaves.click`) |
| Manual: Actions → **"Promover para produção"** | [promote.yml](.github/workflows/promote.yml) → [deploy.yml](.github/workflows/deploy.yml) | Deploy em **produção** do mesmo bundle de uma execução que já passou por staging (sem `run_id`, a mais recente). Só roda a partir da `main` |
| Manual: Actions → **"Rollback"** | [rollback.yml](.github/workflows/rollback.yml) | Volta o tráfego de um ambiente para uma revisão anterior, sem rebuild. Sem `revision_id`, só lista as revisões recentes com o commit de cada uma |

Commits que só mexem em `**.md`, `http/`, `openspec/`, `infra/` ou `.env.example` não rodam o pipeline.

### Deploy com canary

O deploy de cada ambiente ([deploy.yml](.github/workflows/deploy.yml)):

1. Roda as migrations com o secret `MIGRATIONS_DATABASE_URL` **do GitHub Environment** (URL direta do banco daquele ambiente).
2. Envia o bundle ao S3 e cria a revisão com a configuração de `config/env/<ambiente>.json`, mais `APP_VERSION` (commit + execução), que identifica a revisão nas métricas.
3. **Endpoint de teste:** aponta o endpoint `teste` para a revisão nova e faz o smoke test nele. Uma revisão que não sobe para aqui, sem tráfego de usuários.
4. **Canary:** `canary.weight`% do tráfego vai para a revisão nova por `canary.minutes` minutos (staging: 10% por 3 min; prod: 10% por 10 min). Durante esse tempo o job gera tráfego pelo CloudFront e acompanha os alarmes `<função>-5xx` e `<função>-latencia-p95`. No fim, as métricas da própria revisão precisam cumprir `canary.minRequests`, `canary.maxErrorRatePercent` e `canary.maxP95Ms`.
5. Com tudo ok, 100% para a revisão nova, smoke test pelo domínio público e gravação da revisão em `liveRevisionParameter`.

Se algo falhar a partir do passo 4, o job volta todo o tráfego para a revisão anterior e termina com erro. O resumo da execução mostra as métricas do canary.

**Métricas:** a Web Function não publica latência nem separa métricas por revisão. A API publica `Requests`, `Errors5xx` e `Latency` no namespace `ShiftSwap/Api` (EMF, [src/lib/metricas.ts](src/lib/metricas.ts)), com as dimensões `Environment` e `Environment`+`Version`. Os 5xx que o próprio Lambda devolve (revisão que nem responde) só aparecem na métrica nativa `AWS/Lambda/Web`, que é a do alarme de 5xx.

Os jobs declaram o GitHub Environment (`staging`/`production`), e cada role de deploy só pode ser assumida por jobs daquele Environment. Os dois Environments só aceitam a branch `main`.

### Configuração

- **Não secreta:** `config/env/<ambiente>.json` (`serviceConfig.environmentVariables`). Mudar uma variável é um PR nesse arquivo; o deploy aplica. Não edite variáveis pelo console: o próximo deploy sobrescreve.
- **Secreta:** `DATABASE_URL`, `BETTER_AUTH_SECRET` e `ORIGIN_SECRET` no SSM Parameter Store, sob o `SSM_PREFIX` do ambiente, carregadas por [src/lambda.ts](src/lambda.ts).
- **Validação:** [src/config.ts](src/config.ts) valida tudo ao subir e derruba a inicialização com a lista do que falta ou está inválido.

O GitHub acessa a AWS por OIDC, sem chaves guardadas. As roles de deploy (`github-actions-shift-swap-backend-<ambiente>` e `-frontend-<ambiente>`) são criadas pela stack do CDK de cada ambiente e só podem ser assumidas por jobs do GitHub Environment correspondente.

**Migrations no deploy:** o secret `MIGRATIONS_DATABASE_URL` (URL **direta** do Neon) faz o deploy rodar `bun run migrate` antes de publicar. Sem ele as migrations ficam manuais (`bun run migrate:prod`). Para criar:

```bash
gh secret set MIGRATIONS_DATABASE_URL < <(sed -n 's/^DATABASE_URL=//p' .env.production.local)
```

**Migrations compatíveis (expand/contract):** durante o deploy a revisão antiga e a nova rodam contra o mesmo banco, e as migrations rodam antes da revisão nova. Toda migration precisa funcionar com o código que está no ar: adicionar colunas/tabelas (opcionais ou com default) num deploy e só remover ou renomear o que ficou sem uso num deploy seguinte.

**Rollback:** Actions → **"Rollback"** → ambiente e `revision_id`. Rode primeiro sem `revision_id` para ver as revisões recentes, cada uma com o commit. O workflow confere se a revisão está `Active`, move 100% do tráfego, grava `liveRevisionParameter` e faz o smoke test. O resumo mostra a revisão que estava no ar, para desfazer. O rollback não reverte migrations, por isso a regra do expand/contract acima.

## Endpoints

- `GET /health` — health-check, retorna `{ status: "ok", timestamp }`.
- `POST /api/auth/sign-up/email` — cria um usuário `EMPLOYEE`. Corpo: `email`, `password` e `name`. O papel é definido pelo servidor: um `role` enviado no corpo é ignorado.
- Supervisores são promovidos fora da API, a partir de um usuário já cadastrado: `bun run supervisor:promover <email>`. Para os ambientes da AWS, use o sufixo do ambiente: `supervisor:promover:staging` (lê `.env.staging.local`) e `supervisor:promover:prod` (lê `.env.production.local`). Cada arquivo só precisa da `DATABASE_URL` do banco daquele ambiente, que está no SSM em `/shift-swap-api/<ambiente>/DATABASE_URL`. A promoção recusa quem já tem turnos ou solicitações e pode ser repetida sem efeito.
- Para desfazer uma promoção feita por engano: `bun run supervisor:rebaixar <email>` (com os mesmos sufixos: `:staging`, `:prod`). Recusa supervisor que já decidiu solicitações (o histórico aponta para ele) e o último supervisor.
- `POST /api/auth/sign-in/email` — login.
- Demais rotas expostas pelo Better Auth ficam sob o prefixo `/api/auth/*` (ver [documentação](https://www.better-auth.com/docs)).
- `GET /turnos` — rota privada, exige sessão autenticada e `role` `SUPERVISOR` (401 sem sessão, 403 se for `EMPLOYEE`). Lista todos os turnos via `ListarTurnosUseCase`.
- `POST /turnos` — rota privada, só `SUPERVISOR` (401/403 iguais à rota acima). Corpo: `{ data, horaInicio, horaFim, funcionarioId }` (todos obrigatórios; o `supervisorId` vem da sessão). Cria o turno via `CriarTurnoUseCase` e retorna 201; erro de validação de negócio (ex.: horário inválido) retorna 400.
- `PUT /turnos/:id` — rota privada, só `SUPERVISOR`. Corpo: `{ data, horaInicio, horaFim }` (todos obrigatórios). Altera o horário via `AtualizarTurnoUseCase` e retorna 200 com o turno; horário inválido retorna 400 e turno inexistente 404.
- `DELETE /turnos/:id` — rota privada, só `SUPERVISOR`. Exclui o turno via `RemoverTurnoUseCase` e retorna 204; turno inexistente retorna 404 e turno com solicitações de troca no histórico retorna 409.
- `GET /turnos/me?data=YYYY-MM-DD` — rota privada, exige sessão autenticada (qualquer `role`). Lista os turnos do próprio usuário logado (`funcionarioId` vem da sessão, nunca da query) na data informada, via `ListarTurnosPorFuncionarioEDataUseCase`. Retorna 400 se `data` não for informado.
- `GET /funcionarios` — rota privada, só `SUPERVISOR` (401/403 iguais às rotas de turno). Lista todos os funcionários via `ListarFuncionariosUseCase`.
- `GET /funcionarios/colegas` — rota privada, só `EMPLOYEE`. Lista os outros funcionários (`id` e `name`, sem e-mail) para quem pede uma troca escolher o destinatário.
- `GET /turnos/meus` — rota privada, só `EMPLOYEE`. Todos os turnos de quem está logado, em ordem de data e hora.

### Solicitações de troca de turno

O funcionário A pede a troca de um turno seu a um colega B (o *destinatário*). B aceita ou recusa; só depois do aceite o `SUPERVISOR` autoriza (aprova) ou não (rejeita). O usuário vem sempre da sessão, nunca do corpo. Ciclo de vida:

```
pendente ──B aceita──► aguardando_aprovacao ──supervisor──► aprovada | rejeitada
   │                          │
   ├──B recusa──► recusada    └── A cancela / expira
   └── A cancela / expira
```

Toda solicitação na resposta traz `solicitanteNome` e `destinatarioNome`. `aprovada`, `rejeitada`, `recusada`, `cancelada` e `expirada` são finais. O turno só muda de dono na aprovação. Erros: 400 validação, 401 sem sessão, 403 sem permissão (papel errado, ou não é o destinatário/solicitante), 404 não encontrado, 409 transição que o estado atual não permite.

- `POST /solicitacoes-troca` — `EMPLOYEE`. Corpo: `{ turnoId, destinatarioId }`. Só o dono do turno pode pedir, e só uma solicitação em aberto por turno. Retorna 201 com status `pendente`.
- `GET /solicitacoes-troca/recebidas` — `EMPLOYEE`. Pedidos `pendente` endereçados a quem está logado.
- `GET /solicitacoes-troca/enviadas` — `EMPLOYEE`. Pedidos que o usuário logado fez, em qualquer status.
- `POST /solicitacoes-troca/:id/aceitar` — `EMPLOYEE`, só o destinatário. Vai para `aguardando_aprovacao`; falha com 409 se ele já tiver turno no horário.
- `POST /solicitacoes-troca/:id/recusar` — `EMPLOYEE`, só o destinatário. Corpo opcional: `{ motivo }`. Encerra como `recusada`.
- `POST /solicitacoes-troca/:id/cancelar` — `EMPLOYEE`, só o solicitante, enquanto `pendente` ou `aguardando_aprovacao`.
- `GET /solicitacoes-troca?status=` — `SUPERVISOR`. Todas, com filtro opcional (ex.: `aguardando_aprovacao`).
- `GET /solicitacoes-troca/:id` — `SUPERVISOR` vê qualquer uma; `EMPLOYEE` só as que pediu ou recebeu (403 nas demais).
- `POST /solicitacoes-troca/:id/aprovar` — `SUPERVISOR`, sem corpo. Só em `aguardando_aprovacao`; reatribui o turno ao destinatário (409 se a agenda dele mudou e agora conflita).
- `POST /solicitacoes-troca/:id/rejeitar` — `SUPERVISOR`. Corpo: `{ motivo }` (obrigatório). Só em `aguardando_aprovacao`.

**Expiração:** antes de cada rota de `/solicitacoes-troca`, a API roda o `ExpirarSolicitacoesTrocaTurnoUseCase` (no máximo uma vez por minuto por instância), que expira as solicitações em aberto (`pendente` ou `aguardando_aprovacao`) cujo turno já começou. É sob demanda, e não um timer, porque no Lambda não há processo de longa duração. Os turnos são guardados sem fuso; o fuso de referência vem de `APP_TZ` (padrão `America/Sao_Paulo`), independente do `TZ` do processo.

**Banco:** `bun run db:migrate` também migra bancos criados antes do aceite do destinatário (coluna `respondida_em`, novos status e `destinatario_id` obrigatório). Pedidos pendentes do modelo antigo, que não tinham destinatário, são cancelados.

## Testando os endpoints (REST Client)

A pasta [http](http) tem arquivos `*.http` para a extensão [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) do VS Code (clique em *Send Request* acima de cada bloco). Rode `bun run seed` antes: os arquivos usam os usuários do seed (senha `turno-local-seed-2026`).

| Arquivo | Cobre |
| --- | --- |
| [auth.http](http/auth.http) | health, cadastro, login, sessão e logout |
| [turnos.http](http/turnos.http) | `GET/POST /turnos`, `GET /turnos/me` |
| [funcionarios.http](http/funcionarios.http) | `GET /funcionarios` |
| [solicitacoes-troca.http](http/solicitacoes-troca.http) | todas as rotas de `/solicitacoes-troca`, do pedido à aprovação, rejeição e cancelamento |

Cada bloco indica o status esperado no título (ex.: `— 403`). Rode de cima para baixo: os logins trocam o cookie de sessão e os ids ficam guardados em variáveis nomeadas. O fluxo de solicitações cria turnos novos em datas aleatórias de 2099, então pode ser repetido.

## Domínio (biblioteca [`shift-swap`](https://github.com/macndesign/shift-swap))

As regras de negócio de troca de turnos vêm da lib `shift-swap` (entidades, use-cases e ports, sem I/O próprio). A API implementa os repositórios (`Pg*Repository` em [src/lib/shift-swap](src/lib/shift-swap)) e monta os use-cases já prontos para uso em [src/lib/shift-swap/index.ts](src/lib/shift-swap/index.ts).

No signup, os hooks do Better Auth em [src/lib/auth.ts](src/lib/auth.ts) validam nome e e-mail com as regras do domínio (`before`, 400 se inválido) e criam o funcionário com `CriarFuncionarioUseCase` (`after`), reaproveitando o mesmo `id` do usuário autenticado — então `FuncionarioEntity.id === user.id`, sem tabela de vínculo extra. Supervisores vêm da promoção por script (`SupervisorEntity.id === user.id`). As tabelas `funcionario`/`supervisor` (schema em [src/db/schema.sql](src/db/schema.sql)) referenciam `user.id` com `ON DELETE CASCADE`.

A tabela `turno` (schema em [src/db/schema.sql](src/db/schema.sql)) referencia `funcionario.id`. Os use-cases de solicitação de troca ainda não têm rotas na API.

## Integração com o frontend

As origens do front ficam em [src/lib/origins.ts](src/lib/origins.ts): `localhost:5173` sempre, mais as de `CORS_ORIGIN` do ambiente (`config/env/<ambiente>.json`, lista separada por vírgula). O front deve usar `credentials: "include"` nas chamadas, já que a sessão é baseada em cookies. Como o campo `role` é uma extensão do schema padrão, o client do Better Auth no frontend precisa do plugin `inferAdditionalFields`:

```ts
import { createAuthClient } from "better-auth/client";
import { inferAdditionalFields } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: "http://localhost:3000",
  plugins: [
    inferAdditionalFields({
      user: { role: { type: "string" } },
    }),
  ],
});
```

This project was created using `bun init` in bun v1.4.2. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
