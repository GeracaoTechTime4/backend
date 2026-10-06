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

export function toSolicitacaoTrocaTurnoDTO(solicitacao: SolicitacaoTrocaTurno) {
  return {
    id: solicitacao.id,
    status: solicitacao.status,
    solicitanteId: solicitacao.solicitanteId,
    destinatarioId: solicitacao.destinatarioId,
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
