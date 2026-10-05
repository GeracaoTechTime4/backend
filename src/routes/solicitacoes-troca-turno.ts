import type { StatusSolicitacaoTrocaTurno } from "shift-swap";
import { Hono } from "hono";
import type { Context } from "hono";
import { type Env, requireAuth, requireEmployee, requireSupervisor } from "../lib/session-middleware";
import {
  aprovarTrocaTurno,
  buscarSolicitacaoTrocaTurnoPorId,
  cancelarTrocaTurno,
  listarSolicitacoesTrocaTurno,
  listarTurnosDisponiveisParaTroca,
  rejeitarTrocaTurno,
  solicitarTrocaTurno,
} from "../lib/shift-swap";
import { toSolicitacaoTrocaTurnoDTO } from "../lib/shift-swap/dto";

const STATUS_VALIDOS: StatusSolicitacaoTrocaTurno[] = ["pendente", "aprovada", "rejeitada", "cancelada", "expirada"];

// O domínio devolve só mensagens de erro (Result<string>), então o status HTTP é inferido delas.
function statusDoErro(error: unknown): 400 | 404 | 409 {
  const mensagem = String(error);
  if (mensagem.includes("não encontrad")) return 404;
  if (mensagem.includes("não está mais pendente") || mensagem.includes("já possui")) return 409;
  return 400;
}

async function lerBody<T>(c: Context): Promise<T | null> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return null;
  }
}

export const solicitacoesTrocaTurno = new Hono<Env>();

solicitacoesTrocaTurno.use("*", requireAuth);

// Funcionário: pede a troca de um turno seu. O solicitante é sempre quem está logado.
solicitacoesTrocaTurno.post("/", requireEmployee, async (c) => {
  const body = await lerBody<{ turnoId?: string }>(c);

  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.turnoId) {
    return c.json({ error: "turnoId é obrigatório" }, 400);
  }

  const result = await solicitarTrocaTurno.execute({
    turnoId: body.turnoId,
    solicitanteId: c.get("session").user.id,
  });

  if (result.isFailure) {
    return c.json({ error: result.error }, statusDoErro(result.error));
  }

  return c.json({ solicitacao: toSolicitacaoTrocaTurnoDTO(result.getValue()) }, 201);
});

// Funcionário: solicitações pendentes de outros funcionários.
solicitacoesTrocaTurno.get("/disponiveis", requireEmployee, async (c) => {
  const result = await listarTurnosDisponiveisParaTroca.execute({ funcionarioId: c.get("session").user.id });

  if (result.isFailure) {
    return c.json({ error: result.error }, 500);
  }

  return c.json({ solicitacoes: result.getValue().map(toSolicitacaoTrocaTurnoDTO) });
});

// Supervisor: todas as solicitações, com filtro opcional ?status=
solicitacoesTrocaTurno.get("/", requireSupervisor, async (c) => {
  const status = c.req.query("status");

  if (status && !STATUS_VALIDOS.includes(status as StatusSolicitacaoTrocaTurno)) {
    return c.json({ error: `status deve ser um de: ${STATUS_VALIDOS.join(", ")}` }, 400);
  }

  const result = await listarSolicitacoesTrocaTurno.execute();

  if (result.isFailure) {
    return c.json({ error: result.error }, 500);
  }

  const solicitacoes = result.getValue().filter((solicitacao) => !status || solicitacao.status === status);

  return c.json({ solicitacoes: solicitacoes.map(toSolicitacaoTrocaTurnoDTO) });
});

// Supervisor vê qualquer uma; funcionário só as suas.
solicitacoesTrocaTurno.get("/:id", async (c) => {
  const session = c.get("session");
  const result = await buscarSolicitacaoTrocaTurnoPorId.execute({ id: c.req.param("id") });

  if (result.isFailure) {
    return c.json({ error: result.error }, statusDoErro(result.error));
  }

  const solicitacao = result.getValue();
  const ehSupervisor = session.user.role === "SUPERVISOR";

  if (!ehSupervisor && solicitacao.solicitanteId !== session.user.id) {
    return c.json({ error: "Forbidden" }, 403);
  }

  return c.json({ solicitacao: toSolicitacaoTrocaTurnoDTO(solicitacao) });
});

// Supervisor aprova e indica quem assume o turno.
solicitacoesTrocaTurno.post("/:id/aprovar", requireSupervisor, async (c) => {
  const body = await lerBody<{ destinatarioId?: string }>(c);

  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.destinatarioId) {
    return c.json({ error: "destinatarioId é obrigatório" }, 400);
  }

  const result = await aprovarTrocaTurno.execute({
    solicitacaoId: c.req.param("id"),
    supervisorId: c.get("session").user.id,
    destinatarioId: body.destinatarioId,
  });

  if (result.isFailure) {
    return c.json({ error: result.error }, statusDoErro(result.error));
  }

  return c.json({ solicitacao: toSolicitacaoTrocaTurnoDTO(result.getValue()) });
});

solicitacoesTrocaTurno.post("/:id/rejeitar", requireSupervisor, async (c) => {
  const body = await lerBody<{ motivo?: string }>(c);

  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.motivo) {
    return c.json({ error: "motivo é obrigatório" }, 400);
  }

  const result = await rejeitarTrocaTurno.execute({
    solicitacaoId: c.req.param("id"),
    supervisorId: c.get("session").user.id,
    motivo: body.motivo,
  });

  if (result.isFailure) {
    return c.json({ error: result.error }, statusDoErro(result.error));
  }

  return c.json({ solicitacao: toSolicitacaoTrocaTurnoDTO(result.getValue()) });
});

// Funcionário cancela a própria solicitação enquanto pendente.
solicitacoesTrocaTurno.post("/:id/cancelar", requireEmployee, async (c) => {
  const result = await cancelarTrocaTurno.execute({
    solicitacaoId: c.req.param("id"),
    solicitanteId: c.get("session").user.id,
  });

  if (result.isFailure) {
    const status = String(result.error).includes("Somente o solicitante") ? 403 : statusDoErro(result.error);
    return c.json({ error: result.error }, status);
  }

  return c.json({ solicitacao: toSolicitacaoTrocaTurnoDTO(result.getValue()) });
});
