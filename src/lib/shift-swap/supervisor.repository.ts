import { SupervisorEntity, SupervisorRepository } from "shift-swap";
import type { Pool } from "pg";

export class PgSupervisorRepository extends SupervisorRepository {
  constructor(private readonly pool: Pool) {
    super();
  }

  async save(entity: SupervisorEntity): Promise<void> {
    await this.pool.query(
      `INSERT INTO supervisor (id, name, email) VALUES ($1, $2, $3)`,
      [entity.id, entity.name.value, entity.email.value],
    );
  }

  async update(entity: SupervisorEntity): Promise<void> {
    await this.pool.query(
      `UPDATE supervisor SET name = $2, email = $3 WHERE id = $1`,
      [entity.id, entity.name.value, entity.email.value],
    );
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM supervisor WHERE id = $1`, [id]);
  }

  async findById(id: string): Promise<SupervisorEntity | null> {
    const result = await this.pool.query(
      `SELECT id, name, email FROM supervisor WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    return SupervisorEntity.create({ name: row.name, email: row.email }, row.id).getValue();
  }

  async findAll(): Promise<SupervisorEntity[]> {
    const result = await this.pool.query(`SELECT id, name, email FROM supervisor`);
    return result.rows.map((row) =>
      SupervisorEntity.create({ name: row.name, email: row.email }, row.id).getValue(),
    );
  }
}
