import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./lib/auth";
import { iniciarExpiracaoDeSolicitacoes } from "./lib/expirar-solicitacoes";
import { requireAuth, requireEmployee, requireSupervisor } from "./lib/session-middleware";
import {
  atualizarTurno,
  criarTurno,
  listarFuncionarios,
  listarTurnos,
  listarTurnosPorFuncionarioEData,
  removerTurno,
} from "./lib/shift-swap";
import { toColegaDTO, toFuncionarioDTO, toTurnoDTO } from "./lib/shift-swap/dto";
import { solicitacoesTrocaTurno } from "./routes/solicitacoes-troca-turno";

const port = Number(process.env.PORT ?? 3000);

const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = new Hono();

app.use(
  "*",
  cors({
    origin: allowedOrigins,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

app.get("/turnos", requireAuth, requireSupervisor, async (c) => {
  const result = await listarTurnos.execute();

  if (result.isFailure) {
    return c.json({ error: result.error }, 500);
  }

  return c.json({ turnos: result.getValue().map(toTurnoDTO) });
});

app.post("/turnos", requireAuth, requireSupervisor, async (c) => {
  let body: { data?: string; horaInicio?: string; horaFim?: string; funcionarioId?: string };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { data, horaInicio, horaFim, funcionarioId } = body;

  if (!data || !horaInicio || !horaFim || !funcionarioId) {
    return c.json({ error: "data, horaInicio, horaFim e funcionarioId são obrigatórios" }, 400);
  }

  const result = await criarTurno.execute({
    data,
    horaInicio,
    horaFim,
    funcionarioId,
    supervisorId: c.get("session").user.id,
  });

  if (result.isFailure) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({ turno: toTurnoDTO(result.getValue()) }, 201);
});

// O domínio devolve só mensagens de erro, então o status HTTP é inferido delas.
function statusDoErroDeTurno(error: unknown): 400 | 404 {
  return String(error).includes("não encontrad") ? 404 : 400;
}

app.put("/turnos/:id", requireAuth, requireSupervisor, async (c) => {
  let body: { data?: string; horaInicio?: string; horaFim?: string };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { data, horaInicio, horaFim } = body;

  if (!data || !horaInicio || !horaFim) {
    return c.json({ error: "data, horaInicio e horaFim são obrigatórios" }, 400);
  }

  const result = await atualizarTurno.execute({
    id: c.req.param("id"),
    data,
    horaInicio,
    horaFim,
    supervisorId: c.get("session").user.id,
  });

  if (result.isFailure) {
    return c.json({ error: result.error }, statusDoErroDeTurno(result.error));
  }

  return c.json({ turno: toTurnoDTO(result.getValue()) });
});

app.delete("/turnos/:id", requireAuth, requireSupervisor, async (c) => {
  try {
    const result = await removerTurno.execute({
      id: c.req.param("id"),
      supervisorId: c.get("session").user.id,
    });

    if (result.isFailure) {
      return c.json({ error: result.error }, statusDoErroDeTurno(result.error));
    }
  } catch (error) {
    // 23503 = foreign_key_violation: o turno tem solicitações de troca no histórico.
    if ((error as { code?: string }).code === "23503") {
      return c.json({ error: "Não é possível excluir um turno que possui solicitações de troca" }, 409);
    }
    throw error;
  }

  return c.body(null, 204);
});

app.get("/funcionarios", requireAuth, requireSupervisor, async (c) => {
  const result = await listarFuncionarios.execute();

  if (result.isFailure) {
    return c.json({ error: result.error }, 500);
  }

  return c.json({ funcionarios: result.getValue().map(toFuncionarioDTO) });
});

// Funcionário escolhendo um colega para a troca: lista os outros, sem e-mail.
app.get("/funcionarios/colegas", requireAuth, requireEmployee, async (c) => {
  const result = await listarFuncionarios.execute();

  if (result.isFailure) {
    return c.json({ error: result.error }, 500);
  }

  const meuId = c.get("session").user.id;
  const colegas = result.getValue().filter((funcionario) => funcionario.id !== meuId);

  return c.json({ colegas: colegas.map(toColegaDTO) });
});

// Todos os turnos do funcionário logado, em ordem de data e hora.
app.get("/turnos/meus", requireAuth, requireEmployee, async (c) => {
  const result = await listarTurnos.execute();

  if (result.isFailure) {
    return c.json({ error: result.error }, 500);
  }

  const meuId = c.get("session").user.id;
  const meus = result
    .getValue()
    .filter((turno) => turno.funcionarioId === meuId)
    .sort((a, b) => `${a.data}T${a.horaInicio}`.localeCompare(`${b.data}T${b.horaInicio}`));

  return c.json({ turnos: meus.map(toTurnoDTO) });
});

app.get("/turnos/me", requireAuth, async (c) => {
  const data = c.req.query("data");

  if (!data) {
    return c.json({ error: "Query param 'data' is required" }, 400);
  }

  const session = c.get("session");
  const result = await listarTurnosPorFuncionarioEData.execute({
    funcionarioId: session.user.id,
    data,
  });

  if (result.isFailure) {
    return c.json({ error: result.error }, 500);
  }

  return c.json({ turnos: result.getValue().map(toTurnoDTO) });
});

app.route("/solicitacoes-troca", solicitacoesTrocaTurno);

iniciarExpiracaoDeSolicitacoes();

console.log(`shift-swap-api listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
