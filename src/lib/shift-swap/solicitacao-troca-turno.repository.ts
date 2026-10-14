import {
  FuncionarioId,
  SolicitacaoTrocaTurno,
  SolicitacaoTrocaTurnoId,
  type SolicitacaoTrocaTurnoRepository,
  type StatusSolicitacaoTrocaTurno,
  SupervisorId,
  type TurnoId,
} from "shift-swap";
import type { Db } from "../db";
import { turnoDaLinha } from "./turno.repository";

interface SolicitacaoRow {
  id: string;
  solicitante_id: string;
  destinatario_id: string;
  status: StatusSolicitacaoTrocaTurno;
  respondida_em: Date | null;
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
  SELECT s.id, s.solicitante_id, s.destinatario_id, s.status, s.respondida_em,
         s.decidido_por_id, s.decidido_em, s.motivo, s.turno_id,
         t.data AS turno_data, t.hora_inicio AS turno_hora_inicio,
         t.hora_fim AS turno_hora_fim, t.funcionario_id AS turno_funcionario_id
  FROM solicitacao_troca_turno s
  JOIN turno t ON t.id = s.turno_id`;

function toEntity(row: SolicitacaoRow): SolicitacaoTrocaTurno {
  const turno = turnoDaLinha({
    id: row.turno_id,
    data: row.turno_data,
    hora_inicio: row.turno_hora_inicio,
    hora_fim: row.turno_hora_fim,
    funcionario_id: row.turno_funcionario_id,
  });

  // reconstituir (e não create + transições): devolve a solicitação exatamente como foi
  // salva, sem reatribuir o turno nem regravar decididoEm. Ele confere a coerência dos dados
  // com o status; dado incoerente no banco faz o unwrap lançar (erro UNEXPECTED no use case).
  return SolicitacaoTrocaTurno.reconstituir(
    {
      turno,
      solicitanteId: FuncionarioId.from(row.solicitante_id).unwrap(),
      status: row.status,
      destinatarioId: FuncionarioId.from(row.destinatario_id).unwrap(),
      respondidaEm: row.respondida_em ?? undefined,
      decididoPorId: row.decidido_por_id ? SupervisorId.from(row.decidido_por_id).unwrap() : undefined,
      decididoEm: row.decidido_em ?? undefined,
      motivo: row.motivo ?? undefined,
    },
    SolicitacaoTrocaTurnoId.from(row.id).unwrap(),
  ).unwrap();
}

// Ids são objetos: para o SQL vai sempre o `.value`. Sem delete: solicitações são encerradas por
// transição, para manter o histórico (a port do shift-swap não tem delete).
export class PgSolicitacaoTrocaTurnoRepository implements SolicitacaoTrocaTurnoRepository {
  constructor(private readonly pool: Db) {}

  async create(entity: SolicitacaoTrocaTurno): Promise<void> {
    await this.pool.query(
      `INSERT INTO solicitacao_troca_turno
         (id, turno_id, solicitante_id, destinatario_id, status, respondida_em,
          decidido_por_id, decidido_em, motivo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entity.id.value,
        entity.turno.id.value,
        entity.solicitanteId.value,
        entity.destinatarioId.value,
        entity.status,
        entity.respondidaEm ?? null,
        entity.decididoPorId?.value ?? null,
        entity.decididoEm ?? null,
        entity.motivo ?? null,
      ],
    );
  }

  // Só os campos que as transições alteram. turno_id, solicitante_id e destinatario_id nunca
  // mudam; o dono do turno é atualizado pelo TurnoRepository (ver AprovarTrocaTurnoUseCase).
  async update(entity: SolicitacaoTrocaTurno): Promise<void> {
    await this.pool.query(
      `UPDATE solicitacao_troca_turno
       SET status = $2, respondida_em = $3, decidido_por_id = $4, decidido_em = $5, motivo = $6
       WHERE id = $1`,
      [
        entity.id.value,
        entity.status,
        entity.respondidaEm ?? null,
        entity.decididoPorId?.value ?? null,
        entity.decididoEm ?? null,
        entity.motivo ?? null,
      ],
    );
  }

  async findById(id: SolicitacaoTrocaTurnoId): Promise<SolicitacaoTrocaTurno | null> {
    const result = await this.pool.query<SolicitacaoRow>(`${SELECT_SOLICITACAO} WHERE s.id = $1`, [
      id.value,
    ]);
    const row = result.rows[0];
    return row ? toEntity(row) : null;
  }

  async findAll(): Promise<SolicitacaoTrocaTurno[]> {
    const result = await this.pool.query<SolicitacaoRow>(SELECT_SOLICITACAO);
    return result.rows.map(toEntity);
  }

  // "Em aberto" = sem desfecho: pendente (aguarda o destinatário) ou aguardando_aprovacao.
  async findEmAberto(): Promise<SolicitacaoTrocaTurno[]> {
    const result = await this.pool.query<SolicitacaoRow>(
      `${SELECT_SOLICITACAO} WHERE s.status IN ('pendente', 'aguardando_aprovacao')`,
    );
    return result.rows.map(toEntity);
  }

  async findEmAbertoByTurnoId(turnoId: TurnoId): Promise<SolicitacaoTrocaTurno[]> {
    const result = await this.pool.query<SolicitacaoRow>(
      `${SELECT_SOLICITACAO}
       WHERE s.status IN ('pendente', 'aguardando_aprovacao') AND s.turno_id = $1`,
      [turnoId.value],
    );
    return result.rows.map(toEntity);
  }

  async findPendentesByDestinatarioId(destinatarioId: FuncionarioId): Promise<SolicitacaoTrocaTurno[]> {
    const result = await this.pool.query<SolicitacaoRow>(
      `${SELECT_SOLICITACAO} WHERE s.status = 'pendente' AND s.destinatario_id = $1`,
      [destinatarioId.value],
    );
    return result.rows.map(toEntity);
  }
}
