import { beforeAll, describe, expect, test } from "bun:test";
import { api, cadastrarFuncionario, cadastrarSupervisor, dataDaqui, limparBanco, type Cliente } from "./helpers";

// Matriz de acesso: cada rota protegida com sem sessão, funcionário e supervisor. O conteúdo das
// respostas é testado nos outros arquivos; aqui só importa quem passa pelo middleware.
type Papel = "EMPLOYEE" | "SUPERVISOR" | "AMBOS";

const rotas: { metodo: string; caminho: string; papel: Papel; corpo?: unknown }[] = [
  { metodo: "GET", caminho: "/turnos", papel: "SUPERVISOR" },
  { metodo: "POST", caminho: "/turnos", papel: "SUPERVISOR", corpo: {} },
  { metodo: "PUT", caminho: "/turnos/x", papel: "SUPERVISOR", corpo: {} },
  { metodo: "DELETE", caminho: "/turnos/x", papel: "SUPERVISOR" },
  { metodo: "GET", caminho: "/funcionarios", papel: "SUPERVISOR" },
  { metodo: "GET", caminho: "/funcionarios/colegas", papel: "EMPLOYEE" },
  { metodo: "GET", caminho: "/turnos/meus", papel: "EMPLOYEE" },
  { metodo: "GET", caminho: `/turnos/me?data=${dataDaqui(3)}`, papel: "AMBOS" },
  { metodo: "POST", caminho: "/solicitacoes-troca", papel: "EMPLOYEE", corpo: {} },
  { metodo: "GET", caminho: "/solicitacoes-troca/recebidas", papel: "EMPLOYEE" },
  { metodo: "GET", caminho: "/solicitacoes-troca/enviadas", papel: "EMPLOYEE" },
  { metodo: "GET", caminho: "/solicitacoes-troca", papel: "SUPERVISOR" },
  { metodo: "POST", caminho: "/solicitacoes-troca/x/aceitar", papel: "EMPLOYEE" },
  { metodo: "POST", caminho: "/solicitacoes-troca/x/recusar", papel: "EMPLOYEE" },
  { metodo: "POST", caminho: "/solicitacoes-troca/x/cancelar", papel: "EMPLOYEE" },
  { metodo: "POST", caminho: "/solicitacoes-troca/x/aprovar", papel: "SUPERVISOR" },
  { metodo: "POST", caminho: "/solicitacoes-troca/x/rejeitar", papel: "SUPERVISOR", corpo: { motivo: "x" } },
];

let funcionario: Cliente;
let supervisor: Cliente;

beforeAll(async () => {
  await limparBanco();
  funcionario = await cadastrarFuncionario();
  supervisor = await cadastrarSupervisor();
});

describe.each(rotas)("$metodo $caminho ($papel)", ({ metodo, caminho, papel, corpo }) => {
  test("sem sessão: 401", async () => {
    expect((await api(metodo, caminho, { corpo })).status).toBe(401);
  });

  test("funcionário", async () => {
    const r = await api(metodo, caminho, { corpo, cookie: funcionario.cookie });
    if (papel === "SUPERVISOR") expect(r.status).toBe(403);
    else expect([401, 403]).not.toContain(r.status);
  });

  test("supervisor", async () => {
    const r = await api(metodo, caminho, { corpo, cookie: supervisor.cookie });
    if (papel === "EMPLOYEE") expect(r.status).toBe(403);
    else expect([401, 403]).not.toContain(r.status);
  });
});

test("GET /health é público", async () => {
  const r = await api("GET", "/health");
  expect(r.status).toBe(200);
  expect(r.json.status).toBe("ok");
});
