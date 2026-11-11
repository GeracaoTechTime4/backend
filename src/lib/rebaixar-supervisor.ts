import { BaseUseCase, ConflictError, NotFoundError, Result, type ValidationError } from "core-kernel";
import { Email } from "core-kernel/vo";
import { FuncionarioEntity } from "shift-swap";
import type { Db } from "./db";

type RebaixarSupervisorError = ValidationError | NotFoundError | ConflictError;

interface UsuarioRow {
  id: string;
  name: string;
  email: string;
  role: string;
}

/**
 * Desfaz uma promoção feita por engano: o supervisor volta a ser funcionário (EMPLOYEE).
 * Usado por `bun run supervisor:rebaixar <email>`; não há rota HTTP para isso.
 *
 * Recusa:
 * - quem já decidiu solicitações de troca: o histórico aponta para o supervisor (sem cascade);
 * - o último supervisor: sem nenhum, ninguém aprova trocas nem gerencia turnos.
 */
export class RebaixarSupervisorUseCase extends BaseUseCase<{ email: string }, { id: string }, RebaixarSupervisorError> {
  constructor(private readonly db: Db) {
    super();
  }

  protected async handle(input: { email: string }): Promise<Result<{ id: string }, RebaixarSupervisorError>> {
    const email = Email.create(input.email);
    if (email.isFail()) return email;

    const { rows } = await this.db.query<UsuarioRow>(`SELECT id, name, email, role FROM "user" WHERE email = $1`, [
      email.value.value,
    ]);
    const usuario = rows[0];
    if (!usuario) {
      return Result.fail(new NotFoundError("Usuário não encontrado", { code: "USUARIO_NAO_ENCONTRADO" }));
    }

    const funcionario = FuncionarioEntity.create({ name: usuario.name, email: usuario.email }, usuario.id);
    if (funcionario.isFail()) return funcionario;

    if (usuario.role === "SUPERVISOR") {
      const { rows: contagem } = await this.db.query<{ decisoes: number; outros: number }>(
        `SELECT (SELECT count(*) FROM solicitacao_troca_turno WHERE decidido_por_id = $1) AS decisoes,
                (SELECT count(*) FROM "user" WHERE role = 'SUPERVISOR' AND id <> $1) AS outros`,
        [usuario.id],
      );
      if (Number(contagem[0]?.decisoes ?? 0) > 0) {
        return Result.fail(
          new ConflictError("O supervisor já decidiu solicitações de troca e não pode ser rebaixado", {
            code: "SUPERVISOR_COM_DECISOES",
          }),
        );
      }
      if (Number(contagem[0]?.outros ?? 0) === 0) {
        return Result.fail(
          new ConflictError("É o único supervisor: promova outro antes de rebaixar este", {
            code: "ULTIMO_SUPERVISOR",
          }),
        );
      }
    }

    // Um único comando é atômico no Postgres: papel, registro de funcionário e remoção do supervisor
    // acontecem juntos ou nenhum acontece. Repetir o rebaixamento não muda nada.
    const { id, name, email: emailFuncionario } = funcionario.value;
    await this.db.query(
      `WITH papel AS (UPDATE "user" SET role = 'EMPLOYEE' WHERE id = $1),
            supervisor AS (DELETE FROM supervisor WHERE id = $1)
       INSERT INTO funcionario (id, name, email) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [id.value, name.value, emailFuncionario.value],
    );

    return Result.ok({ id: id.value });
  }
}
