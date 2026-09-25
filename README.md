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

3. Suba apenas o Postgres (ou use um Postgres já existente):

   ```bash
   docker compose up -d postgres
   ```

4. Aplique o schema do Better Auth e o schema de domínio (tabelas `funcionario`/`supervisor`) no banco:

   ```bash
   bun run migrate
   ```

5. (Opcional) Popule o banco com dados de teste — 1 supervisor, 2 funcionários e alguns turnos:

   ```bash
   bun run seed
   ```

   O script imprime as credenciais criadas (senha `password123` para todos). É idempotente: rodar de novo reaproveita os usuários já existentes em vez de duplicar.

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

## Endpoints

- `GET /health` — health-check, retorna `{ status: "ok", timestamp }`.
- `POST /api/auth/sign-up/email` — cria um usuário. O corpo deve incluir `email`, `password`, `name` e `role` (`"SUPERVISOR"` ou `"EMPLOYEE"`), este último obrigatório para diferenciar os dois tipos de usuário.
- `POST /api/auth/sign-in/email` — login.
- Demais rotas expostas pelo Better Auth ficam sob o prefixo `/api/auth/*` (ver [documentação](https://www.better-auth.com/docs)).
- `GET /turnos` — rota privada, exige sessão autenticada e `role` `SUPERVISOR` (401 sem sessão, 403 se for `EMPLOYEE`). Lista todos os turnos via `ListarTurnosUseCase`.
- `POST /turnos` — rota privada, só `SUPERVISOR` (401/403 iguais à rota acima). Corpo: `{ data, horaInicio, horaFim, funcionarioId }` (todos obrigatórios). Cria o turno via `CriarTurnoUseCase` e retorna 201; erro de validação de negócio (ex.: horário inválido) retorna 400.
- `GET /turnos/me?data=YYYY-MM-DD` — rota privada, exige sessão autenticada (qualquer `role`). Lista os turnos do próprio usuário logado (`funcionarioId` vem da sessão, nunca da query) na data informada, via `ListarTurnosPorFuncionarioEDataUseCase`. Retorna 400 se `data` não for informado.
- `GET /funcionarios` — rota privada, só `SUPERVISOR` (401/403 iguais às rotas de turno). Lista todos os funcionários via `ListarFuncionariosUseCase`.

## Domínio (biblioteca [`shift-swap`](https://github.com/macndesign/shift-swap))

As regras de negócio de troca de turnos vêm da lib `shift-swap` (entidades, use-cases e ports, sem I/O próprio). A API implementa os repositórios (`Pg*Repository` em [src/lib/shift-swap](src/lib/shift-swap)) e monta os use-cases já prontos para uso em [src/lib/shift-swap/index.ts](src/lib/shift-swap/index.ts).

No signup, um hook do Better Auth (`databaseHooks.user.create.after` em [src/lib/auth.ts](src/lib/auth.ts)) chama `CriarSupervisorUseCase` ou `CriarFuncionarioUseCase` de acordo com o `role` escolhido, reaproveitando o mesmo `id` do usuário autenticado — então `FuncionarioEntity.id === user.id` (ou `SupervisorEntity.id === user.id`), sem tabela de vínculo extra. As tabelas `funcionario`/`supervisor` (schema em [src/db/schema.sql](src/db/schema.sql)) referenciam `user.id` com `ON DELETE CASCADE`.

A tabela `turno` (schema em [src/db/schema.sql](src/db/schema.sql)) referencia `funcionario.id`. Os use-cases de solicitação de troca ainda não têm rotas na API.

## Integração com o frontend

O frontend deve ser adicionado em `CORS_ORIGIN` (lista separada por vírgula) e usar `credentials: "include"` nas chamadas, já que a sessão é baseada em cookies. Como o campo `role` é uma extensão do schema padrão, o client do Better Auth no frontend precisa do plugin `inferAdditionalFields`:

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
