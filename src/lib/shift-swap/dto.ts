import type { FuncionarioEntity, SolicitacaoTrocaTurno, Turno } from "shift-swap";

export function toTurnoDTO(turno: Turno) {
  return {
    id: turno.id,
    data: turno.data,
    horaInicio: turno.horaInicio,
    horaFim: turno.horaFim,
    funcionarioId: turno.funcionarioId,
  };
}

// `nomes` (id -> nome do funcionário) deixa a tela mostrar quem é quem sem consultas extras.
export function toSolicitacaoTrocaTurnoDTO(
  solicitacao: SolicitacaoTrocaTurno,
  nomes: ReadonlyMap<string, string> = new Map(),
) {
  return {
    id: solicitacao.id,
    status: solicitacao.status,
    solicitanteId: solicitacao.solicitanteId,
    solicitanteNome: nomes.get(solicitacao.solicitanteId) ?? null,
    destinatarioId: solicitacao.destinatarioId,
    destinatarioNome: nomes.get(solicitacao.destinatarioId) ?? null,
    respondidaEm: solicitacao.respondidaEm?.toISOString() ?? null,
    turno: toTurnoDTO(solicitacao.turno),
    decididoPorId: solicitacao.decididoPorId ?? null,
    decididoEm: solicitacao.decididoEm?.toISOString() ?? null,
    motivo: solicitacao.motivo ?? null,
  };
}

export function toFuncionarioDTO(funcionario: FuncionarioEntity) {
  return {
    id: funcionario.id,
    name: funcionario.name.value,
    email: funcionario.email.value,
  };
}

// Versão enxuta para o funcionário escolher um colega: sem e-mail.
export function toColegaDTO(funcionario: FuncionarioEntity) {
  return {
    id: funcionario.id,
    name: funcionario.name.value,
  };
}
