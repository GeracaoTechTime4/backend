import type { StatusSolicitacaoTrocaTurno } from "shift-swap";
import { Hono } from "hono";
import type { Context } from "hono";
import { type Env, requireAuth, requireEmployee, requireSupervisor } from "../lib/session-middleware";
import {
  aceitarTrocaTurno,
  aprovarTrocaTurno,
  buscarSolicitacaoTrocaTurnoPorId,
  cancelarTrocaTurno,
  listarFuncionarios,
  listarSolicitacoesRecebidas,
  listarSolicitacoesTrocaTurno,
  recusarTrocaTurno,
  rejeitarTrocaTurno,
  solicitarTrocaTurno,
} from "../lib/shift-swap";
import { toSolicitacaoTrocaTurnoDTO } from "../lib/shift-swap/dto";

const STATUS_VALIDOS: StatusSolicitacaoTrocaTurno[] = [
  "pendente",
  "aguardando_aprovacao",
  "aprovada",
  "rejeitada",
  "recusada",
  "cancelada",
  "expirada",
];

// O domínio devolve só mensagens de erro (Result<string>), então o status HTTP é inferido delas.
function statusDoErro(error: unknown): 400 | 403 | 404 | 409 {
  const mensagem = String(error);
  if (mensagem.includes("não encontrad")) return 404;
  if (mensagem.startsWith("Somente o")) return 403;
  if (
    mensagem.startsWith("Não é possível") ||
    mensagem.includes("em aberto") ||
    mensagem.includes("já possui")
  ) {
    return 409;
  }
  return 400;
}

async function lerBody<T>(c: Context): Promise<T | null> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return null;
  }
}

// Corpo opcional: sem corpo (ou vazio) vale como {}, mas JSON malformado continua sendo 400.
async function lerBodyOpcional<T extends object>(c: Context): Promise<T | null> {
  const texto = await c.req.text();
  if (texto.trim().length === 0) return {} as T;
  try {
    return JSON.parse(texto) as T;
  } catch {
    return null;
  }
}

// id -> nome de todos os funcionários, para a resposta já trazer quem pediu e quem recebeu.
async function nomesDosFuncionarios(): Promise<Map<string, string>> {
  const result = await listarFuncionarios.execute();
  const funcionarios = result.isSuccess ? result.getValue() : [];
  return new Map(funcionarios.map((funcionario) => [funcionario.id, funcionario.name.value]));
}

export const solicitacoesTrocaTurno = new Hono<Env>();

solicitacoesTrocaTurno.use("*", requireAuth);

// Funcionário A: pede a troca de um turno seu a um colega B. O solicitante é sempre quem
// está logado. A solicitação nasce "pendente", aguardando a resposta de B.
solicitacoesTrocaTurno.post("/", requireEmployee, async (c) => {
  const body = await lerBody<{ turnoId?: string; destinatarioId?: string }>(c);

  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.turnoId || !body.destinatarioId) {
    return c.json({ error: "turnoId e destinatarioId são obrigatórios" }, 400);
  }

  const result = await solicitarTrocaTurno.execute({
    turnoId: body.turnoId,
    solicitanteId: c.get("session").user.id,
    destinatarioId: body.destinatarioId,
  });

  if (result.isFailure) {
    return c.json({ error: result.error }, statusDoErro(result.error));
  }

  return c.json({ solicitacao: toSolicitacaoTrocaTurnoDTO(result.getValue(), await nomesDosFuncionarios()) }, 201);
});

// Funcionário B: pedidos de troca endereçados a ele que ainda esperam a resposta dele.
solicitacoesTrocaTurno.get("/recebidas", requireEmployee, async (c) => {
  const result = await listarSolicitacoesRecebidas.execute({ funcionarioId: c.get("session").user.id });

  if (result.isFailure) {
    return c.json({ error: result.error }, 500);
  }

  const nomes = await nomesDosFuncionarios();

  return c.json({ solicitacoes: result.getValue().map((s) => toSolicitacaoTrocaTurnoDTO(s, nomes)) });
});

// Funcionário A: pedidos que ele fez, em qualquer status (para acompanhar a resposta).
solicitacoesTrocaTurno.get("/enviadas", requireEmployee, async (c) => {
  const result = await listarSolicitacoesTrocaTurno.execute();

  if (result.isFailure) {
    return c.json({ error: result.error }, 500);
  }

  const meuId = c.get("session").user.id;
  const enviadas = result.getValue().filter((solicitacao) => solicitacao.solicitanteId === meuId);
  const nomes = await nomesDosFuncionarios();

  return c.json({ solicitacoes: enviadas.map((s) => toSolicitacaoTrocaTurnoDTO(s, nomes)) });
});

// Supervisor: todas as solicitações, com filtro opcional ?status= (ex.: aguardando_aprovacao).
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

  const nomes = await nomesDosFuncionarios();

  return c.json({ solicitacoes: solicitacoes.map((s) => toSolicitacaoTrocaTurnoDTO(s, nomes)) });
});

// Supervisor vê qualquer uma; funcionário só as suas (como solicitante ou destinatário).
solicitacoesTrocaTurno.get("/:id", async (c) => {
  const session = c.get("session");
  const result = await buscarSolicitacaoTrocaTurnoPorId.execute({ id: c.req.param("id") });

  if (result.isFailure) {
    return c.json({ error: result.error }, statusDoErro(result.error));
  }

  const solicitacao = result.getValue();
  const ehSupervisor = session.user.role === "SUPERVISOR";
  const ehParte = solicitacao.solicitanteId === session.user.id || solicitacao.destinatarioId === session.user.id;

  if (!ehSupervisor && !ehParte) {
    return c.json({ error: "Forbidden" }, 403);
  }

  return c.json({ solicitacao: toSolicitacaoTrocaTurnoDTO(solicitacao, await nomesDosFuncionarios()) });
});

// Funcionário B aceita: a solicitação passa a "aguardando_aprovacao" (decide o supervisor).
solicitacoesTrocaTurno.post("/:id/aceitar", requireEmployee, async (c) => {
  const result = await aceitarTrocaTurno.execute({
    solicitacaoId: c.req.param("id"),
    funcionarioId: c.get("session").user.id,
  });

  if (result.isFailure) {
    return c.json({ error: result.error }, statusDoErro(result.error));
  }

  return c.json({ solicitacao: toSolicitacaoTrocaTurnoDTO(result.getValue(), await nomesDosFuncionarios()) });
});

// Funcionário B recusa (motivo opcional): a solicitação é encerrada como "recusada".
solicitacoesTrocaTurno.post("/:id/recusar", requireEmployee, async (c) => {
  const body = await lerBodyOpcional<{ motivo?: string }>(c);

  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const result = await recusarTrocaTurno.execute({
    solicitacaoId: c.req.param("id"),
    funcionarioId: c.get("session").user.id,
    motivo: body.motivo,
  });

  if (result.isFailure) {
    return c.json({ error: result.error }, statusDoErro(result.error));
  }

  return c.json({ solicitacao: toSolicitacaoTrocaTurnoDTO(result.getValue(), await nomesDosFuncionarios()) });
});

// Supervisor autoriza uma troca que o destinatário já aceitou; o turno passa para ele.
solicitacoesTrocaTurno.post("/:id/aprovar", requireSupervisor, async (c) => {
  const result = await aprovarTrocaTurno.execute({
    solicitacaoId: c.req.param("id"),
    supervisorId: c.get("session").user.id,
  });

  if (result.isFailure) {
    return c.json({ error: result.error }, statusDoErro(result.error));
  }

  return c.json({ solicitacao: toSolicitacaoTrocaTurnoDTO(result.getValue(), await nomesDosFuncionarios()) });
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

  return c.json({ solicitacao: toSolicitacaoTrocaTurnoDTO(result.getValue(), await nomesDosFuncionarios()) });
});

// Funcionário A cancela a própria solicitação enquanto não houver desfecho
// (pendente ou aguardando_aprovacao).
solicitacoesTrocaTurno.post("/:id/cancelar", requireEmployee, async (c) => {
  const result = await cancelarTrocaTurno.execute({
    solicitacaoId: c.req.param("id"),
    solicitanteId: c.get("session").user.id,
  });

  if (result.isFailure) {
    return c.json({ error: result.error }, statusDoErro(result.error));
  }

  return c.json({ solicitacao: toSolicitacaoTrocaTurnoDTO(result.getValue(), await nomesDosFuncionarios()) });
});
