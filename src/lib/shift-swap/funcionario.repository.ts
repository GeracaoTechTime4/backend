import { FuncionarioEntity, FuncionarioRepository } from "shift-swap";
import type { Pool } from "pg";

export class PgFuncionarioRepository extends FuncionarioRepository {
  constructor(private readonly pool: Pool) {
    super();
  }

  async save(entity: FuncionarioEntity): Promise<void> {
    await this.pool.query(
      `INSERT INTO funcionario (id, name, email) VALUES ($1, $2, $3)`,
      [entity.id, entity.name.value, entity.email.value],
    );
  }

  async update(entity: FuncionarioEntity): Promise<void> {
    await this.pool.query(
      `UPDATE funcionario SET name = $2, email = $3 WHERE id = $1`,
      [entity.id, entity.name.value, entity.email.value],
    );
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM funcionario WHERE id = $1`, [id]);
  }

  async findById(id: string): Promise<FuncionarioEntity | null> {
    const result = await this.pool.query(
      `SELECT id, name, email FROM funcionario WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    return FuncionarioEntity.create({ name: row.name, email: row.email }, row.id).getValue();
  }

  async findAll(): Promise<FuncionarioEntity[]> {
    const result = await this.pool.query(`SELECT id, name, email FROM funcionario`);
    return result.rows.map((row) =>
      FuncionarioEntity.create({ name: row.name, email: row.email }, row.id).getValue(),
    );
  }
}
