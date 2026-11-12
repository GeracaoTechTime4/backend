import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { auth } from "./lib/auth";
import { withClientIp } from "./lib/client-ip";
import { config } from "./config";
import { metricasHttp } from "./lib/metricas";
import { exigirOrigemCloudFront } from "./lib/origin-verify";
import { allowedOrigins } from "./lib/origins";
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
import { codigoPostgres, respostaDeErro } from "./lib/shift-swap/http";
import { solicitacoesTrocaTurno } from "./routes/solicitacoes-troca-turno";

// No Lambda Web Functions o runtime informa host:porta em AWS_LAMBDA_HTTP_ENDPOINT e sonda
// exatamente esse endereço; localmente vale PORT (padrão 3000).
const [hostname = "0.0.0.0", porta] = (
  process.env.AWS_LAMBDA_HTTP_ENDPOINT ?? `0.0.0.0:${process.env.PORT ?? 3000}`
).split(":");
const port = Number(porta);

const app = new Hono();

// Antes de tudo, para medir também as respostas 403 e as de erro.
app.use("*", metricasHttp(config.APP_ENV, config.APP_VERSION));

app.use("*", exigirOrigemCloudFront(config.ORIGIN_SECRET));

app.use("*", secureHeaders());

app.use(
  "*",
  cors({
    origin: allowedOrigins,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(withClientIp(c.req.raw)));

app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

app.get("/turnos", requireAuth, requireSupervisor, async (c) => {
  const result = await listarTurnos.execute();

  if (result.isFail()) {
    return respostaDeErro(c, result.error);
  }

  return c.json({ turnos: result.value.map(toTurnoDTO) });
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

  if (result.isFail()) {
    return respostaDeErro(c, result.error);
  }

  return c.json({ turno: toTurnoDTO(result.value) }, 201);
});

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

  if (result.isFail()) {
    return respostaDeErro(c, result.error);
  }

  return c.json({ turno: toTurnoDTO(result.value) });
});

app.delete("/turnos/:id", requireAuth, requireSupervisor, async (c) => {
  const result = await removerTurno.execute({
    id: c.req.param("id"),
    supervisorId: c.get("session").user.id,
  });

  if (result.isFail()) {
    // 23503 = foreign_key_violation: o turno tem solicitações de troca no histórico. A exceção
    // do pg chega como erro UNEXPECTED do use case, com o erro original em `cause`.
    if (codigoPostgres(result.error) === "23503") {
      return c.json({ error: "Não é possível excluir um turno que possui solicitações de troca" }, 409);
    }
    return respostaDeErro(c, result.error);
  }

  return c.body(null, 204);
});

app.get("/funcionarios", requireAuth, requireSupervisor, async (c) => {
  const result = await listarFuncionarios.execute();

  if (result.isFail()) {
    return respostaDeErro(c, result.error);
  }

  return c.json({ funcionarios: result.value.map(toFuncionarioDTO) });
});

// Funcionário escolhendo um colega para a troca: lista os outros, sem e-mail.
app.get("/funcionarios/colegas", requireAuth, requireEmployee, async (c) => {
  const result = await listarFuncionarios.execute();

  if (result.isFail()) {
    return respostaDeErro(c, result.error);
  }

  const meuId = c.get("session").user.id;
  const colegas = result.value.filter((funcionario) => funcionario.id.value !== meuId);

  return c.json({ colegas: colegas.map(toColegaDTO) });
});

// Todos os turnos do funcionário logado, em ordem de data e hora.
app.get("/turnos/meus", requireAuth, requireEmployee, async (c) => {
  const result = await listarTurnos.execute();

  if (result.isFail()) {
    return respostaDeErro(c, result.error);
  }

  const meuId = c.get("session").user.id;
  const meus = result.value
    .filter((turno) => turno.funcionarioId.value === meuId)
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

  if (result.isFail()) {
    return respostaDeErro(c, result.error);
  }

  return c.json({ turnos: result.value.map(toTurnoDTO) });
});

app.route("/solicitacoes-troca", solicitacoesTrocaTurno);

// No Bun (dev, `bun --hot`) o export default abaixo sobe o servidor e permite hot reload;
// no Node (Lambda Web Functions) quem sobe é o @hono/node-server.
if (!process.versions.bun) {
  serve({ fetch: app.fetch, hostname, port }, () => {
    console.log(`shift-swap-api listening on ${hostname}:${port}`);
  });
}

export default {
  hostname,
  port,
  fetch: app.fetch,
};
