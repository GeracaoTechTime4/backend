import { expirarSolicitacoesTrocaTurno } from "./shift-swap";

// Os turnos são guardados sem fuso; o fuso de referência vem de APP_TZ e não do TZ do processo,
// que no Lambda é definido pelo runtime (UTC).
const FUSO = process.env.APP_TZ ?? "America/Sao_Paulo";

// "sv-SE" formata como "YYYY-MM-DD HH:mm", o mesmo formato (com T) usado nos turnos.
const formatador = new Intl.DateTimeFormat("sv-SE", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function referenciaAgora(agora = new Date()): string {
  return formatador.format(agora).replace(" ", "T");
}

// A referência tem resolução de minuto, então basta expirar uma vez por minuto em cada
// ambiente. Guarda a execução em andamento para que requisições concorrentes aguardem a mesma.
let ultima: { referencia: string; execucao: Promise<void> } | undefined;

async function expirar(referencia: string): Promise<void> {
  try {
    const result = await expirarSolicitacoesTrocaTurno.execute({ referencia });

    if (result.isFail()) {
      console.error("Falha ao expirar solicitações de troca:", result.error.message, result.error.cause ?? "");
      return;
    }

    const expiradas = result.value.length;
    if (expiradas > 0) {
      console.log(`${expiradas} solicitação(ões) de troca expirada(s)`);
    }
  } catch (error) {
    console.error("Erro ao expirar solicitações de troca:", error);
  }
}

/**
 * Expira as solicitações em aberto cujo turno já começou. Roda sob demanda (antes das rotas
 * de solicitações), já que no Lambda não há processo de longa duração para um setInterval.
 */
export function expirarSolicitacoesPendentes(): Promise<void> {
  const referencia = referenciaAgora();
  if (ultima?.referencia !== referencia) {
    ultima = { referencia, execucao: expirar(referencia) };
  }
  return ultima.execucao;
}
