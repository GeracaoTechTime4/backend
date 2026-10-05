import { SolicitacaoTrocaTurno, SolicitacaoTrocaTurnoRepository, Turno } from "shift-swap";
import type { StatusSolicitacaoTrocaTurno } from "shift-swap";
import type { Pool } from "pg";

interface SolicitacaoRow {
  id: string;
  solicitante_id: string;
  destinatario_id: string | null;
  status: StatusSolicitacaoTrocaTurno;
  decidido_por_id: string | null;
  decidido_em: Date | null;
  motivo: string | null;
  turno_id: string;
  turno_data: string;
  turno_hora_inicio: string;
  turno_hora_fim: string;
  turno_funcionario_id: string;
}

// A solicitação sempre é carregada junto com o turno (JOIN), porque a entidade guarda o
// Turno inteiro e não só o id.
const SELECT_SOLICITACAO = `
  SELECT s.id, s.solicitante_id, s.destinatario_id, s.status, s.decidido_por_id,
         s.decidido_em, s.motivo, s.turno_id,
         t.data AS turno_data, t.hora_inicio AS turno_hora_inicio,
         t.hora_fim AS turno_hora_fim, t.funcionario_id AS turno_funcionario_id
  FROM solicitacao_troca_turno s
  JOIN turno t ON t.id = s.turno_id`;

function toEntity(row: SolicitacaoRow): SolicitacaoTrocaTurno {
  const turno = Turno.create(
    {
      data: row.turno_data,
      horaInicio: row.turno_hora_inicio,
      horaFim: row.turno_hora_fim,
      funcionarioId: row.turno_funcionario_id,
    },
    row.turno_id,
  ).getValue();

  // reconstituir (e não create + transições): devolve a solicitação exatamente como foi
  // salva, sem reatribuir o turno nem regravar decididoEm.
  return SolicitacaoTrocaTurno.reconstituir(
    {
      turno,
      solicitanteId: row.solicitante_id,
      status: row.status,
      destinatarioId: row.destinatario_id ?? undefined,
      decididoPorId: row.decidido_por_id ?? undefined,
      decididoEm: row.decidido_em ?? undefined,
      motivo: row.motivo ?? undefined,
    },
    row.id,
  ).getValue();
}

export class PgSolicitacaoTrocaTurnoRepository extends SolicitacaoTrocaTurnoRepository {
  constructor(private readonly pool: Pool) {
    super();
  }

  async save(entity: SolicitacaoTrocaTurno): Promise<void> {
    await this.pool.query(
      `INSERT INTO solicitacao_troca_turno
         (id, turno_id, solicitante_id, destinatario_id, status, decidido_por_id, decidido_em, motivo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entity.id,
        entity.turno.id,
        entity.solicitanteId,
        entity.destinatarioId ?? null,
        entity.status,
        entity.decididoPorId ?? null,
        entity.decididoEm ?? null,
        entity.motivo ?? null,
      ],
    );
  }

  // Só os campos que as transições alteram. turno_id e solicitante_id nunca mudam; o dono
  // do turno é atualizado pelo TurnoRepository (ver AprovarTrocaTurnoUseCase).
  async update(entity: SolicitacaoTrocaTurno): Promise<void> {
    await this.pool.query(
      `UPDATE solicitacao_troca_turno
       SET destinatario_id = $2, status = $3, decidido_por_id = $4, decidido_em = $5, motivo = $6
       WHERE id = $1`,
      [
        entity.id,
        entity.destinatarioId ?? null,
        entity.status,
        entity.decididoPorId ?? null,
        entity.decididoEm ?? null,
        entity.motivo ?? null,
      ],
    );
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM solicitacao_troca_turno WHERE id = $1`, [id]);
  }

  async findById(id: string): Promise<SolicitacaoTrocaTurno | null> {
    const result = await this.pool.query<SolicitacaoRow>(`${SELECT_SOLICITACAO} WHERE s.id = $1`, [id]);
    const row = result.rows[0];
    return row ? toEntity(row) : null;
  }

  async findAll(): Promise<SolicitacaoTrocaTurno[]> {
    const result = await this.pool.query<SolicitacaoRow>(SELECT_SOLICITACAO);
    return result.rows.map(toEntity);
  }

  async findPendentes(): Promise<SolicitacaoTrocaTurno[]> {
    const result = await this.pool.query<SolicitacaoRow>(
      `${SELECT_SOLICITACAO} WHERE s.status = 'pendente'`,
    );
    return result.rows.map(toEntity);
  }

  async findPendentesByTurnoId(turnoId: string): Promise<SolicitacaoTrocaTurno[]> {
    const result = await this.pool.query<SolicitacaoRow>(
      `${SELECT_SOLICITACAO} WHERE s.status = 'pendente' AND s.turno_id = $1`,
      [turnoId],
    );
    return result.rows.map(toEntity);
  }

  async findPendentesExcetoSolicitante(solicitanteId: string): Promise<SolicitacaoTrocaTurno[]> {
    const result = await this.pool.query<SolicitacaoRow>(
      `${SELECT_SOLICITACAO} WHERE s.status = 'pendente' AND s.solicitante_id <> $1`,
      [solicitanteId],
    );
    return result.rows.map(toEntity);
  }
}
