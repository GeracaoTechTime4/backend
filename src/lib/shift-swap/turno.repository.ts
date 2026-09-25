import { Turno, TurnoRepository } from "shift-swap";
import type { Pool } from "pg";

interface TurnoRow {
  id: string;
  data: string;
  hora_inicio: string;
  hora_fim: string;
  funcionario_id: string;
}

function toEntity(row: TurnoRow): Turno {
  return Turno.create(
    { data: row.data, horaInicio: row.hora_inicio, horaFim: row.hora_fim, funcionarioId: row.funcionario_id },
    row.id,
  ).getValue();
}

export class PgTurnoRepository extends TurnoRepository {
  constructor(private readonly pool: Pool) {
    super();
  }

  async save(entity: Turno): Promise<void> {
    await this.pool.query(
      `INSERT INTO turno (id, data, hora_inicio, hora_fim, funcionario_id) VALUES ($1, $2, $3, $4, $5)`,
      [entity.id, entity.data, entity.horaInicio, entity.horaFim, entity.funcionarioId],
    );
  }

  async update(entity: Turno): Promise<void> {
    await this.pool.query(
      `UPDATE turno SET data = $2, hora_inicio = $3, hora_fim = $4, funcionario_id = $5 WHERE id = $1`,
      [entity.id, entity.data, entity.horaInicio, entity.horaFim, entity.funcionarioId],
    );
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM turno WHERE id = $1`, [id]);
  }

  async findById(id: string): Promise<Turno | null> {
    const result = await this.pool.query<TurnoRow>(
      `SELECT id, data, hora_inicio, hora_fim, funcionario_id FROM turno WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? toEntity(row) : null;
  }

  async findAll(): Promise<Turno[]> {
    const result = await this.pool.query<TurnoRow>(
      `SELECT id, data, hora_inicio, hora_fim, funcionario_id FROM turno`,
    );
    return result.rows.map(toEntity);
  }

  async findByFuncionarioIdAndData(funcionarioId: string, data: string): Promise<Turno[]> {
    const result = await this.pool.query<TurnoRow>(
      `SELECT id, data, hora_inicio, hora_fim, funcionario_id FROM turno WHERE funcionario_id = $1 AND data = $2`,
      [funcionarioId, data],
    );
    return result.rows.map(toEntity);
  }
}
