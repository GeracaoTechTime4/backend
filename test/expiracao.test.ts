import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { api, cadastrarFuncionario, cadastrarSupervisor, criarTurno, limparBanco, solicitar, type Cliente } from "./helpers";

// Solicitações em aberto expiram quando o turno começa (src/lib/expirar-solicitacoes.ts). A expiração
// roda antes de cada rota de /solicitacoes-troca, no máximo uma vez por minuto, com o horário de APP_TZ
// (America/Sao_Paulo nos testes). O relógio é avançado com setSystemTime: um minuto novo faz rodar de novo.

let supervisor: Cliente;
let joao: Cliente;
let maria: Cliente;

beforeEach(async () => {
  await limparBanco();
  supervisor = await cadastrarSupervisor();
  joao = await cadastrarFuncionario("João Silva");
  maria = await cadastrarFuncionario("Maria Souza");
});

afterEach(() => {
  setSystemTime(); // volta ao relógio real
});

async function pedir(dias: number) {
  const turno = await criarTurno(supervisor, joao, { dias, inicio: "08:00", fim: "16:00" });
  const { json } = await solicitar(joao, turno.id, maria);
  return { turno, id: json.solicitacao.id as string };
}

const status = async (id: string) =>
  (await api("GET", `/solicitacoes-troca/${id}`, { cookie: joao.cookie })).json.solicitacao.status;

/** Instante em que o turno de `data` às 08:00 em São Paulo (UTC-3) já começou: 09:00 locais. */
const depoisDoInicio = (data: string) => new Date(`${data}T12:00:00Z`);

test("pendente e aguardando_aprovacao expiram quando o turno começa; turno futuro não", async () => {
  const pendente = await pedir(2);
  const aguardando = await pedir(2);
  const futura = await pedir(10);
  await api("POST", `/solicitacoes-troca/${aguardando.id}/aceitar`, { cookie: maria.cookie });

  expect(await status(pendente.id)).toBe("pendente");

  setSystemTime(depoisDoInicio(pendente.turno.data));
  expect(await status(pendente.id)).toBe("expirada");
  expect(await status(aguardando.id)).toBe("expirada");
  expect(await status(futura.id)).toBe("pendente");
});

test("depois de expirar, nenhuma ação é aceita (409)", async () => {
  const { id, turno } = await pedir(2);
  setSystemTime(depoisDoInicio(turno.data));

  const aceitar = await api("POST", `/solicitacoes-troca/${id}/aceitar`, { cookie: maria.cookie });
  expect(aceitar.status).toBe(409);
  expect(aceitar.json.code).toBe("TRANSICAO_INVALIDA");
  expect((await api("POST", `/solicitacoes-troca/${id}/cancelar`, { cookie: joao.cookie })).status).toBe(409);
});

test("estados finais não mudam", async () => {
  const { id, turno } = await pedir(2);
  await api("POST", `/solicitacoes-troca/${id}/recusar`, { cookie: maria.cookie });

  setSystemTime(depoisDoInicio(turno.data));
  expect(await status(id)).toBe("recusada");
});

test("um minuto antes do início ainda não expira", async () => {
  const { id, turno } = await pedir(2);
  setSystemTime(new Date(`${turno.data}T10:59:00Z`)); // 07:59 em São Paulo
  expect(await status(id)).toBe("pendente");
  setSystemTime(new Date(`${turno.data}T11:00:00Z`)); // 08:00: começou
  expect(await status(id)).toBe("expirada");
});
