import { beforeEach, describe, expect, test } from "bun:test";
import {
  api,
  cadastrarFuncionario,
  cadastrarSupervisor,
  criarTurno,
  dataDaqui,
  limparBanco,
  solicitar,
  type Cliente,
} from "./helpers";

let supervisor: Cliente;
let joao: Cliente;

beforeEach(async () => {
  await limparBanco();
  supervisor = await cadastrarSupervisor();
  joao = await cadastrarFuncionario("João Silva");
});

describe("POST /turnos", () => {
  test("cria o turno", async () => {
    const r = await api("POST", "/turnos", {
      cookie: supervisor.cookie,
      corpo: { data: dataDaqui(5), horaInicio: "08:00", horaFim: "16:00", funcionarioId: joao.id },
    });
    expect(r.status).toBe(201);
    expect(r.json.turno).toMatchObject({ data: dataDaqui(5), horaInicio: "08:00", horaFim: "16:00", funcionarioId: joao.id });
  });

  test("JSON inválido e campos faltando: 400 sem code", async () => {
    const invalido = await api("POST", "/turnos", { cookie: supervisor.cookie, corpoCru: "{nao é json" });
    expect(invalido.status).toBe(400);
    expect(invalido.json.code).toBeUndefined();

    const faltando = await api("POST", "/turnos", { cookie: supervisor.cookie, corpo: { data: dataDaqui(5) } });
    expect(faltando.status).toBe(400);
    expect(faltando.json.code).toBeUndefined();
  });

  test("validação do domínio vira 400 com code e issues", async () => {
    const r = await api("POST", "/turnos", {
      cookie: supervisor.cookie,
      corpo: { data: dataDaqui(5), horaInicio: "16:00", horaFim: "08:00", funcionarioId: joao.id },
    });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("HORARIO_INVALIDO");
    expect(r.json.issues).toHaveLength(1);
  });

  test("funcionário inexistente: 404 FUNCIONARIO_NAO_ENCONTRADO", async () => {
    const r = await api("POST", "/turnos", {
      cookie: supervisor.cookie,
      corpo: { data: dataDaqui(5), horaInicio: "08:00", horaFim: "16:00", funcionarioId: "nao-existe" },
    });
    expect(r.status).toBe(404);
    expect(r.json.code).toBe("FUNCIONARIO_NAO_ENCONTRADO");
  });

  // Comportamento atual, documentado no PENDENCIAS.md: a sobreposição só é checada ao aceitar ou
  // aprovar uma troca, não ao criar ou editar turnos. Se virar regra, este teste deve mudar para 409.
  test("turno sobreposto ao de outro do mesmo funcionário é aceito", async () => {
    await criarTurno(supervisor, joao, { dias: 5, inicio: "08:00", fim: "16:00" });
    const r = await api("POST", "/turnos", {
      cookie: supervisor.cookie,
      corpo: { data: dataDaqui(5), horaInicio: "10:00", horaFim: "12:00", funcionarioId: joao.id },
    });
    expect(r.status).toBe(201);
  });
});

describe("PUT e DELETE /turnos/:id", () => {
  test("edita o turno", async () => {
    const turno = await criarTurno(supervisor, joao);
    const r = await api("PUT", `/turnos/${turno.id}`, {
      cookie: supervisor.cookie,
      corpo: { data: dataDaqui(9), horaInicio: "09:00", horaFim: "17:00" },
    });
    expect(r.status).toBe(200);
    expect(r.json.turno).toMatchObject({ id: turno.id, data: dataDaqui(9), horaInicio: "09:00", horaFim: "17:00" });
  });

  test("id inexistente: 404 TURNO_NAO_ENCONTRADO", async () => {
    const put = await api("PUT", "/turnos/nao-existe", {
      cookie: supervisor.cookie,
      corpo: { data: dataDaqui(9), horaInicio: "09:00", horaFim: "17:00" },
    });
    expect(put.status).toBe(404);
    expect(put.json.code).toBe("TURNO_NAO_ENCONTRADO");

    const del = await api("DELETE", "/turnos/nao-existe", { cookie: supervisor.cookie });
    expect(del.status).toBe(404);
    expect(del.json.code).toBe("TURNO_NAO_ENCONTRADO");
  });

  test("exclui o turno", async () => {
    const turno = await criarTurno(supervisor, joao);
    const r = await api("DELETE", `/turnos/${turno.id}`, { cookie: supervisor.cookie });
    expect(r.status).toBe(204);

    const lista = await api("GET", "/turnos", { cookie: supervisor.cookie });
    expect(lista.json.turnos).toHaveLength(0);
  });

  test("turno com solicitação no histórico não pode ser excluído: 409", async () => {
    const maria = await cadastrarFuncionario("Maria Souza");
    const turno = await criarTurno(supervisor, joao);
    expect((await solicitar(joao, turno.id, maria)).status).toBe(201);

    const r = await api("DELETE", `/turnos/${turno.id}`, { cookie: supervisor.cookie });
    expect(r.status).toBe(409);
  });
});

describe("turnos do funcionário", () => {
  test("GET /turnos/meus traz só os do usuário, ordenados por data e hora", async () => {
    const maria = await cadastrarFuncionario("Maria Souza");
    await criarTurno(supervisor, joao, { dias: 9, inicio: "08:00", fim: "12:00" });
    await criarTurno(supervisor, joao, { dias: 3, inicio: "14:00", fim: "18:00" });
    await criarTurno(supervisor, joao, { dias: 3, inicio: "08:00", fim: "12:00" });
    await criarTurno(supervisor, maria, { dias: 4 });

    const r = await api("GET", "/turnos/meus", { cookie: joao.cookie });
    expect(r.status).toBe(200);
    expect(r.json.turnos.map((t: any) => `${t.data} ${t.horaInicio}`)).toEqual([
      `${dataDaqui(3)} 08:00`,
      `${dataDaqui(3)} 14:00`,
      `${dataDaqui(9)} 08:00`,
    ]);
  });

  test("GET /turnos/me exige data", async () => {
    await criarTurno(supervisor, joao, { dias: 3 });
    const sem = await api("GET", "/turnos/me", { cookie: joao.cookie });
    expect(sem.status).toBe(400);

    const com = await api("GET", `/turnos/me?data=${dataDaqui(3)}`, { cookie: joao.cookie });
    expect(com.status).toBe(200);
    expect(com.json.turnos).toHaveLength(1);
  });
});
