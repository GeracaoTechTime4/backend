import { Email, Text } from "core-kernel/vo";
import { FuncionarioEntity, FuncionarioId, type FuncionarioRepository } from "shift-swap";
import type { Db } from "../db";

interface PessoaRow {
  id: string;
  name: string;
  email: string;
}

// Dados do banco já foram validados na escrita: reconstituir não revalida. Um unwrap que falhe
// aqui indica dado corrompido e vira erro UNEXPECTED no use case.
function toEntity(row: PessoaRow): FuncionarioEntity {
  return FuncionarioEntity.reconstituir(
    { name: Text.create(row.name).unwrap(), email: Email.create(row.email).unwrap() },
    FuncionarioId.from(row.id).unwrap(),
  );
}

// Ids são objetos (FuncionarioId): para o SQL vai sempre o `.value`.
export class PgFuncionarioRepository implements FuncionarioRepository {
  constructor(private readonly pool: Db) {}

  async create(entity: FuncionarioEntity): Promise<void> {
    await this.pool.query(`INSERT INTO funcionario (id, name, email) VALUES ($1, $2, $3)`, [
      entity.id.value,
      entity.name.value,
      entity.email.value,
    ]);
  }

  async update(entity: FuncionarioEntity): Promise<void> {
    await this.pool.query(`UPDATE funcionario SET name = $2, email = $3 WHERE id = $1`, [
      entity.id.value,
      entity.name.value,
      entity.email.value,
    ]);
  }

  async delete(id: FuncionarioId): Promise<void> {
    await this.pool.query(`DELETE FROM funcionario WHERE id = $1`, [id.value]);
  }

  async findById(id: FuncionarioId): Promise<FuncionarioEntity | null> {
    const result = await this.pool.query<PessoaRow>(
      `SELECT id, name, email FROM funcionario WHERE id = $1`,
      [id.value],
    );
    const row = result.rows[0];
    return row ? toEntity(row) : null;
  }

  async findAll(): Promise<FuncionarioEntity[]> {
    const result = await this.pool.query<PessoaRow>(`SELECT id, name, email FROM funcionario`);
    return result.rows.map(toEntity);
  }
}
