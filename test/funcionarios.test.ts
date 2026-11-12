import { beforeEach, expect, test } from "bun:test";
import { api, cadastrarFuncionario, cadastrarSupervisor, limparBanco } from "./helpers";

beforeEach(limparBanco);

test("GET /funcionarios lista todos os funcionários, com e-mail, e não inclui supervisores", async () => {
  const supervisor = await cadastrarSupervisor();
  const joao = await cadastrarFuncionario("João Silva");
  const maria = await cadastrarFuncionario("Maria Souza");

  const r = await api("GET", "/funcionarios", { cookie: supervisor.cookie });
  expect(r.status).toBe(200);
  const ids = r.json.funcionarios.map((f: any) => f.id).sort();
  expect(ids).toEqual([joao.id, maria.id].sort());
  expect(r.json.funcionarios.find((f: any) => f.id === joao.id)).toEqual({ id: joao.id, name: "João Silva", email: joao.email });
});

test("GET /funcionarios/colegas não traz o próprio usuário nem e-mails", async () => {
  await cadastrarSupervisor();
  const joao = await cadastrarFuncionario("João Silva");
  const maria = await cadastrarFuncionario("Maria Souza");

  const r = await api("GET", "/funcionarios/colegas", { cookie: joao.cookie });
  expect(r.status).toBe(200);
  expect(r.json.colegas).toEqual([{ id: maria.id, name: "Maria Souza" }]);
});
