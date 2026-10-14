import type { FuncionarioEntity, SolicitacaoTrocaTurno, Turno } from "shift-swap";

export function toTurnoDTO(turno: Turno) {
  return {
    id: turno.id.value,
    data: turno.data,
    horaInicio: turno.horaInicio,
    horaFim: turno.horaFim,
    funcionarioId: turno.funcionarioId.value,
  };
}

// `nomes` (id -> nome do funcionário) deixa a tela mostrar quem é quem sem consultas extras.
export function toSolicitacaoTrocaTurnoDTO(
  solicitacao: SolicitacaoTrocaTurno,
  nomes: ReadonlyMap<string, string> = new Map(),
) {
  return {
    id: solicitacao.id.value,
    status: solicitacao.status,
    solicitanteId: solicitacao.solicitanteId.value,
    solicitanteNome: nomes.get(solicitacao.solicitanteId.value) ?? null,
    destinatarioId: solicitacao.destinatarioId.value,
    destinatarioNome: nomes.get(solicitacao.destinatarioId.value) ?? null,
    respondidaEm: solicitacao.respondidaEm?.toISOString() ?? null,
    turno: toTurnoDTO(solicitacao.turno),
    decididoPorId: solicitacao.decididoPorId?.value ?? null,
    decididoEm: solicitacao.decididoEm?.toISOString() ?? null,
    motivo: solicitacao.motivo ?? null,
  };
}

export function toFuncionarioDTO(funcionario: FuncionarioEntity) {
  return {
    id: funcionario.id.value,
    name: funcionario.name.value,
    email: funcionario.email.value,
  };
}

// Versão enxuta para o funcionário escolher um colega: sem e-mail.
export function toColegaDTO(funcionario: FuncionarioEntity) {
  return {
    id: funcionario.id.value,
    name: funcionario.name.value,
  };
}
