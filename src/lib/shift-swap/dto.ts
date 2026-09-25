import type { FuncionarioEntity, Turno } from "shift-swap";

export function toTurnoDTO(turno: Turno) {
  return {
    id: turno.id,
    data: turno.data,
    horaInicio: turno.horaInicio,
    horaFim: turno.horaFim,
    funcionarioId: turno.funcionarioId,
  };
}

export function toFuncionarioDTO(funcionario: FuncionarioEntity) {
  return {
    id: funcionario.id,
    name: funcionario.name.value,
    email: funcionario.email.value,
  };
}
