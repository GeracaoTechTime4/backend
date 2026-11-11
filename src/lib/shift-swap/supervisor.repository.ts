import { Email, Text } from "core-kernel/vo";
import { SupervisorEntity, SupervisorId, type SupervisorRepository } from "shift-swap";
import type { Db } from "../db";

interface PessoaRow {
  id: string;
  name: string;
  email: string;
}

// Ver comentário em funcionario.repository.ts.
function toEntity(row: PessoaRow): SupervisorEntity {
  return SupervisorEntity.reconstituir(
    { name: Text.create(row.name).unwrap(), email: Email.create(row.email).unwrap() },
    SupervisorId.from(row.id).unwrap(),
  );
}

// A port do shift-swap só exige create e findById; update/delete/findAll não eram usados.
export class PgSupervisorRepository implements SupervisorRepository {
  constructor(private readonly pool: Db) {}

  async create(entity: SupervisorEntity): Promise<void> {
    await this.pool.query(`INSERT INTO supervisor (id, name, email) VALUES ($1, $2, $3)`, [
      entity.id.value,
      entity.name.value,
      entity.email.value,
    ]);
  }

  async findById(id: SupervisorId): Promise<SupervisorEntity | null> {
    const result = await this.pool.query<PessoaRow>(
      `SELECT id, name, email FROM supervisor WHERE id = $1`,
      [id.value],
    );
    const row = result.rows[0];
    return row ? toEntity(row) : null;
  }
}
