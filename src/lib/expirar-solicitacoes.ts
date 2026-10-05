import { expirarSolicitacoesTrocaTurno } from "./shift-swap";

const INTERVALO_MS = 60_000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Mesmo formato (YYYY-MM-DDTHH:mm) e mesmo fuso dos turnos, que são guardados sem fuso.
// O fuso é o do processo: defina TZ no ambiente (ex.: America/Sao_Paulo).
function referenciaAgora(agora = new Date()): string {
  const data = `${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}`;
  return `${data}T${pad(agora.getHours())}:${pad(agora.getMinutes())}`;
}

async function expirar(): Promise<void> {
  try {
    const result = await expirarSolicitacoesTrocaTurno.execute({ referencia: referenciaAgora() });

    if (result.isFailure) {
      console.error("Falha ao expirar solicitações de troca:", result.error);
      return;
    }

    const expiradas = result.getValue().length;
    if (expiradas > 0) {
      console.log(`${expiradas} solicitação(ões) de troca expirada(s)`);
    }
  } catch (error) {
    console.error("Erro ao expirar solicitações de troca:", error);
  }
}

export function iniciarExpiracaoDeSolicitacoes(): void {
  void expirar();
  setInterval(() => void expirar(), INTERVALO_MS);
}
