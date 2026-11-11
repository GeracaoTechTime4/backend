import { BaseUseCase, ConflictError, NotFoundError, Result, type ValidationError } from "core-kernel";
import { Email } from "core-kernel/vo";
import { SupervisorEntity } from "shift-swap";
import type { Db } from "./db";

type PromoverSupervisorError = ValidationError | NotFoundError | ConflictError;

interface UsuarioRow {
  id: string;
  name: string;
  email: string;
  role: string;
}

/**
 * Promove a supervisor um usuário já cadastrado (o cadastro público sempre cria EMPLOYEE).
 * Usado pelo seed e por `bun run supervisor:promover <email>`; não há rota HTTP para isso.
 *
 * Recusa quem já tem turnos ou solicitações: apagar o registro de funcionário levaria os turnos
 * junto (ON DELETE CASCADE) e o histórico de solicitações impede a exclusão.
 */
export class PromoverSupervisorUseCase extends BaseUseCase<{ email: string }, { id: string }, PromoverSupervisorError> {
  constructor(private readonly db: Db) {
    super();
  }

  protected async handle(input: { email: string }): Promise<Result<{ id: string }, PromoverSupervisorError>> {
    const email = Email.create(input.email);
    if (email.isFail()) return email;

    const { rows } = await this.db.query<UsuarioRow>(`SELECT id, name, email, role FROM "user" WHERE email = $1`, [
      email.value.value,
    ]);
    const usuario = rows[0];
    if (!usuario) {
      return Result.fail(new NotFoundError("Usuário não encontrado", { code: "USUARIO_NAO_ENCONTRADO" }));
    }

    const supervisor = SupervisorEntity.create({ name: usuario.name, email: usuario.email }, usuario.id);
    if (supervisor.isFail()) return supervisor;

    const { rows: vinculos } = await this.db.query<{ total: number }>(
      `SELECT (SELECT count(*) FROM turno WHERE funcionario_id = $1)
            + (SELECT count(*) FROM solicitacao_troca_turno WHERE solicitante_id = $1 OR destinatario_id = $1)
            AS total`,
      [usuario.id],
    );
    if (Number(vinculos[0]?.total ?? 0) > 0) {
      return Result.fail(
        new ConflictError("O funcionário já tem turnos ou solicitações e não pode virar supervisor", {
          code: "FUNCIONARIO_COM_HISTORICO",
        }),
      );
    }

    // Um único comando é atômico no Postgres: papel, registro de supervisor e remoção do funcionário
    // acontecem juntos ou nenhum acontece. Repetir a promoção não muda nada.
    const { id, name, email: emailSupervisor } = supervisor.value;
    await this.db.query(
      `WITH papel AS (UPDATE "user" SET role = 'SUPERVISOR' WHERE id = $1),
            funcionario AS (DELETE FROM funcionario WHERE id = $1)
       INSERT INTO supervisor (id, name, email) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [id.value, name.value, emailSupervisor.value],
    );

    return Result.ok({ id: id.value });
  }
}
