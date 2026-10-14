import { FuncionarioId, Turno, TurnoId, type TurnoRepository } from "shift-swap";
import type { Db } from "../db";

interface TurnoRow {
  id: string;
  data: string;
  hora_inicio: string;
  hora_fim: string;
  funcionario_id: string;
}

export function turnoDaLinha(row: TurnoRow): Turno {
  return Turno.reconstituir(
    {
      data: row.data,
      horaInicio: row.hora_inicio,
      horaFim: row.hora_fim,
      funcionarioId: FuncionarioId.from(row.funcionario_id).unwrap(),
    },
    TurnoId.from(row.id).unwrap(),
  );
}

// Ids são objetos (TurnoId, FuncionarioId): para o SQL vai sempre o `.value`.
export class PgTurnoRepository implements TurnoRepository {
  constructor(private readonly pool: Db) {}

  async create(entity: Turno): Promise<void> {
    await this.pool.query(
      `INSERT INTO turno (id, data, hora_inicio, hora_fim, funcionario_id) VALUES ($1, $2, $3, $4, $5)`,
      [entity.id.value, entity.data, entity.horaInicio, entity.horaFim, entity.funcionarioId.value],
    );
  }

  async update(entity: Turno): Promise<void> {
    await this.pool.query(
      `UPDATE turno SET data = $2, hora_inicio = $3, hora_fim = $4, funcionario_id = $5 WHERE id = $1`,
      [entity.id.value, entity.data, entity.horaInicio, entity.horaFim, entity.funcionarioId.value],
    );
  }

  async delete(id: TurnoId): Promise<void> {
    await this.pool.query(`DELETE FROM turno WHERE id = $1`, [id.value]);
  }

  async findById(id: TurnoId): Promise<Turno | null> {
    const result = await this.pool.query<TurnoRow>(
      `SELECT id, data, hora_inicio, hora_fim, funcionario_id FROM turno WHERE id = $1`,
      [id.value],
    );
    const row = result.rows[0];
    return row ? turnoDaLinha(row) : null;
  }

  async findAll(): Promise<Turno[]> {
    const result = await this.pool.query<TurnoRow>(
      `SELECT id, data, hora_inicio, hora_fim, funcionario_id FROM turno`,
    );
    return result.rows.map(turnoDaLinha);
  }

  async findByFuncionarioIdAndData(funcionarioId: FuncionarioId, data: string): Promise<Turno[]> {
    const result = await this.pool.query<TurnoRow>(
      `SELECT id, data, hora_inicio, hora_fim, funcionario_id FROM turno WHERE funcionario_id = $1 AND data = $2`,
      [funcionarioId.value, data],
    );
    return result.rows.map(turnoDaLinha);
  }
}
