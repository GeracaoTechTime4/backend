import { beforeEach, describe, expect, test } from "bun:test";
import { PromoverSupervisorUseCase } from "../src/lib/promover-supervisor";
import { RebaixarSupervisorUseCase } from "../src/lib/rebaixar-supervisor";
import {
  api,
  cadastrar,
  cadastrarFuncionario,
  cadastrarSupervisor,
  criarTurno,
  limparBanco,
  login,
  pool,
  solicitar,
} from "./helpers";

// Os use cases por trás de `bun run supervisor:promover` e `supervisor:rebaixar`.
const promover = (email: string) => new PromoverSupervisorUseCase(pool).execute({ email });
const rebaixar = (email: string) => new RebaixarSupervisorUseCase(pool).execute({ email });

beforeEach(limparBanco);

describe("promover", () => {
  test("vira supervisor e a próxima sessão já tem o papel novo", async () => {
    const { email } = await cadastrar("Gabi Rocha");
    expect((await promover(email)).isOk()).toBe(true);
    const { cookie } = await login(email);
    expect((await api("GET", "/turnos", { cookie })).status).toBe(200);
  });

  test("e-mail inexistente: USUARIO_NAO_ENCONTRADO", async () => {
    const r = await promover("ninguem@example.com");
    expect(r.isFail() && r.error.code).toBe("USUARIO_NAO_ENCONTRADO");
  });

  test("funcionário com turnos não pode ser promovido: FUNCIONARIO_COM_HISTORICO", async () => {
    const supervisor = await cadastrarSupervisor();
    const joao = await cadastrarFuncionario();
    await criarTurno(supervisor, joao);
    const r = await promover(joao.email);
    expect(r.isFail() && r.error.code).toBe("FUNCIONARIO_COM_HISTORICO");
  });

  test("promover de novo não muda nada", async () => {
    const supervisor = await cadastrarSupervisor();
    expect((await promover(supervisor.email)).isOk()).toBe(true);
    expect((await api("GET", "/turnos", { cookie: supervisor.cookie })).status).toBe(200);
  });
});

describe("rebaixar", () => {
  test("volta a funcionário quando há outro supervisor e nenhuma decisão", async () => {
    await cadastrarSupervisor("Primeira");
    const segunda = await cadastrarSupervisor("Segunda");
    expect((await rebaixar(segunda.email)).isOk()).toBe(true);
    const { cookie } = await login(segunda.email);
    expect((await api("GET", "/turnos/meus", { cookie })).status).toBe(200);
  });

  test("o último supervisor não pode ser rebaixado: ULTIMO_SUPERVISOR", async () => {
    const unica = await cadastrarSupervisor();
    const r = await rebaixar(unica.email);
    expect(r.isFail() && r.error.code).toBe("ULTIMO_SUPERVISOR");
  });

  test("supervisor que já decidiu solicitações não pode ser rebaixado: SUPERVISOR_COM_DECISOES", async () => {
    const decidiu = await cadastrarSupervisor("Decidiu");
    await cadastrarSupervisor("Outra");
    const joao = await cadastrarFuncionario();
    const maria = await cadastrarFuncionario();
    const turno = await criarTurno(decidiu, joao);
    const { json } = await solicitar(joao, turno.id, maria);
    await api("POST", `/solicitacoes-troca/${json.solicitacao.id}/aceitar`, { cookie: maria.cookie });
    expect(
      (await api("POST", `/solicitacoes-troca/${json.solicitacao.id}/aprovar`, { cookie: decidiu.cookie })).status,
    ).toBe(200);

    const r = await rebaixar(decidiu.email);
    expect(r.isFail() && r.error.code).toBe("SUPERVISOR_COM_DECISOES");
  });
});
