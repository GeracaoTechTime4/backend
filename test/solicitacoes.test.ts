import { beforeEach, describe, expect, test } from "bun:test";
import {
  api,
  cadastrarFuncionario,
  cadastrarSupervisor,
  criarTurno,
  limparBanco,
  solicitar,
  type Cliente,
} from "./helpers";

// Cenários da API; as regras puras (máquina de estados, horários) já são testadas na lib shift-swap.
// Referência: os requests numerados de http/solicitacoes-troca.http.

let supervisor: Cliente;
let joao: Cliente; // solicitante (A)
let maria: Cliente; // destinatária (B)

beforeEach(async () => {
  await limparBanco();
  supervisor = await cadastrarSupervisor();
  joao = await cadastrarFuncionario("João Silva");
  maria = await cadastrarFuncionario("Maria Souza");
});

const acao = (quem: Cliente, id: string, nome: string, corpo?: unknown) =>
  api("POST", `/solicitacoes-troca/${id}/${nome}`, { cookie: quem.cookie, corpo });

async function pedirTroca(opcoes?: Parameters<typeof criarTurno>[2]) {
  const turno = await criarTurno(supervisor, joao, opcoes);
  const r = await solicitar(joao, turno.id, maria);
  expect(r.status).toBe(201);
  return { turno, id: r.json.solicitacao.id as string };
}

const turnosDe = async (quem: Cliente) =>
  (await api("GET", "/turnos/meus", { cookie: quem.cookie })).json.turnos.map((t: any) => t.id);

describe("ciclo completo", () => {
  test("A pede, B aceita, supervisor aprova: o turno passa para B", async () => {
    const { turno, id } = await pedirTroca();
    const criada = (await api("GET", `/solicitacoes-troca/${id}`, { cookie: joao.cookie })).json.solicitacao;
    expect(criada).toMatchObject({
      status: "pendente",
      solicitanteNome: "João Silva",
      destinatarioNome: "Maria Souza",
      turno: { id: turno.id },
    });

    const aceita = await acao(maria, id, "aceitar");
    expect(aceita.status).toBe(200);
    expect(aceita.json.solicitacao.status).toBe("aguardando_aprovacao");
    expect(aceita.json.solicitacao.respondidaEm).not.toBeNull();
    expect(await turnosDe(joao)).toEqual([turno.id]); // ainda é do João até a aprovação

    const aprovada = await acao(supervisor, id, "aprovar");
    expect(aprovada.status).toBe(200);
    expect(aprovada.json.solicitacao).toMatchObject({ status: "aprovada", decididoPorId: supervisor.id });
    expect(aprovada.json.solicitacao.decididoEm).not.toBeNull();

    expect(await turnosDe(joao)).toEqual([]);
    expect(await turnosDe(maria)).toEqual([turno.id]);
  });

  test("B recusa com motivo; o turno fica com A e um novo pedido é permitido", async () => {
    const { turno, id } = await pedirTroca();
    const recusada = await acao(maria, id, "recusar", { motivo: "Tenho consulta" });
    expect(recusada.status).toBe(200);
    expect(recusada.json.solicitacao).toMatchObject({ status: "recusada", motivo: "Tenho consulta" });
    expect(await turnosDe(joao)).toEqual([turno.id]);

    expect((await solicitar(joao, turno.id, maria)).status).toBe(201);
  });

  test("B recusa sem corpo", async () => {
    const { id } = await pedirTroca();
    const r = await api("POST", `/solicitacoes-troca/${id}/recusar`, { cookie: maria.cookie });
    expect(r.status).toBe(200);
    expect(r.json.solicitacao.status).toBe("recusada");
  });

  test("supervisor rejeita: motivo obrigatório, turno fica com A", async () => {
    const { turno, id } = await pedirTroca();
    await acao(maria, id, "aceitar");

    const semMotivo = await acao(supervisor, id, "rejeitar", {});
    expect(semMotivo.status).toBe(400);
    const soEspacos = await acao(supervisor, id, "rejeitar", { motivo: "   " });
    expect(soEspacos.status).toBe(400);
    expect(soEspacos.json.code).toBe("MOTIVO_OBRIGATORIO");

    const rejeitada = await acao(supervisor, id, "rejeitar", { motivo: "Equipe desfalcada" });
    expect(rejeitada.status).toBe(200);
    expect(rejeitada.json.solicitacao).toMatchObject({ status: "rejeitada", motivo: "Equipe desfalcada" });
    expect(await turnosDe(joao)).toEqual([turno.id]);
  });

  test("A cancela em pendente e em aguardando_aprovacao", async () => {
    const primeira = await pedirTroca({ dias: 5 });
    expect((await acao(joao, primeira.id, "cancelar")).json.solicitacao.status).toBe("cancelada");

    const segunda = await pedirTroca({ dias: 6 });
    await acao(maria, segunda.id, "aceitar");
    expect((await acao(joao, segunda.id, "cancelar")).json.solicitacao.status).toBe("cancelada");
  });
});

describe("criação", () => {
  test("só uma solicitação em aberto por turno: 409 SOLICITACAO_EM_ABERTO_EXISTENTE", async () => {
    const { turno } = await pedirTroca();
    const r = await solicitar(joao, turno.id, maria);
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("SOLICITACAO_EM_ABERTO_EXISTENTE");
  });

  test("validações da rota e do domínio", async () => {
    const turno = await criarTurno(supervisor, joao);
    const post = (corpo: unknown, quem = joao) => api("POST", "/solicitacoes-troca", { cookie: quem.cookie, corpo });

    expect((await api("POST", "/solicitacoes-troca", { cookie: joao.cookie, corpoCru: "{" })).status).toBe(400);
    expect((await post({ turnoId: turno.id })).status).toBe(400);
    expect((await post({ turnoId: turno.id, destinatarioId: "nao-existe" })).json.code).toBe("FUNCIONARIO_NAO_ENCONTRADO");
    expect((await post({ turnoId: "nao-existe", destinatarioId: maria.id })).json.code).toBe("TURNO_NAO_ENCONTRADO");
    expect((await post({ turnoId: turno.id, destinatarioId: joao.id })).json.code).toBe("DESTINATARIO_IGUAL_SOLICITANTE");

    const alheio = await post({ turnoId: turno.id, destinatarioId: joao.id }, maria);
    expect(alheio.status).toBe(403);
    expect(alheio.json.code).toBe("SOMENTE_DONO_DO_TURNO");
  });

  test("destinatário que é supervisor não é funcionário: 404", async () => {
    const turno = await criarTurno(supervisor, joao);
    const r = await api("POST", "/solicitacoes-troca", {
      cookie: joao.cookie,
      corpo: { turnoId: turno.id, destinatarioId: supervisor.id },
    });
    expect(r.status).toBe(404);
  });
});

describe("quem pode agir", () => {
  test("A não aceita nem recusa; B não cancela", async () => {
    const { id } = await pedirTroca();
    expect((await acao(joao, id, "aceitar")).json.code).toBe("SOMENTE_DESTINATARIO");
    expect((await acao(joao, id, "recusar")).json.code).toBe("SOMENTE_DESTINATARIO");
    expect((await acao(maria, id, "cancelar")).json.code).toBe("SOMENTE_SOLICITANTE");
  });

  test("transições inválidas: 409 TRANSICAO_INVALIDA", async () => {
    const { id } = await pedirTroca();
    expect((await acao(supervisor, id, "aprovar")).json.code).toBe("TRANSICAO_INVALIDA"); // ainda pendente
    await acao(maria, id, "aceitar");
    const dupla = await acao(maria, id, "aceitar");
    expect(dupla.status).toBe(409);
    expect(dupla.json.code).toBe("TRANSICAO_INVALIDA");
    await acao(supervisor, id, "aprovar");
    expect((await acao(supervisor, id, "aprovar")).status).toBe(409);
    expect((await acao(joao, id, "cancelar")).status).toBe(409);
  });

  test("id inexistente: 404 SOLICITACAO_NAO_ENCONTRADA", async () => {
    for (const [quem, nome] of [
      [maria, "aceitar"],
      [joao, "cancelar"],
      [supervisor, "aprovar"],
    ] as const) {
      const r = await acao(quem, "nao-existe", nome);
      expect(r.status).toBe(404);
      expect(r.json.code).toBe("SOLICITACAO_NAO_ENCONTRADA");
    }
  });
});

describe("conflito de horário", () => {
  test("ao aceitar, se B já tem turno sobreposto: 409 CONFLITO_DE_HORARIO", async () => {
    await criarTurno(supervisor, maria, { dias: 7, inicio: "12:00", fim: "20:00" });
    const { id } = await pedirTroca({ dias: 7, inicio: "08:00", fim: "16:00" });
    const r = await acao(maria, id, "aceitar");
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("CONFLITO_DE_HORARIO");
  });

  test("turnos encostados (fim de um = início do outro) não conflitam", async () => {
    await criarTurno(supervisor, maria, { dias: 7, inicio: "16:00", fim: "22:00" });
    const { id } = await pedirTroca({ dias: 7, inicio: "08:00", fim: "16:00" });
    expect((await acao(maria, id, "aceitar")).status).toBe(200);
  });

  test("ao aprovar, se B ganhou um turno sobreposto depois de aceitar: 409", async () => {
    const { id } = await pedirTroca({ dias: 7, inicio: "08:00", fim: "16:00" });
    await acao(maria, id, "aceitar");
    await criarTurno(supervisor, maria, { dias: 7, inicio: "10:00", fim: "12:00" });
    const r = await acao(supervisor, id, "aprovar");
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("CONFLITO_DE_HORARIO");
  });
});

describe("consultas", () => {
  test("GET /:id: partes e supervisor veem; um terceiro funcionário não", async () => {
    const pedro = await cadastrarFuncionario("Pedro Alves");
    const { id } = await pedirTroca();
    for (const quem of [joao, maria, supervisor]) {
      expect((await api("GET", `/solicitacoes-troca/${id}`, { cookie: quem.cookie })).status).toBe(200);
    }
    expect((await api("GET", `/solicitacoes-troca/${id}`, { cookie: pedro.cookie })).status).toBe(403);
    expect((await api("GET", "/solicitacoes-troca/nao-existe", { cookie: joao.cookie })).status).toBe(404);
  });

  test("recebidas só traz as pendentes para mim; enviadas traz todas as minhas", async () => {
    const pendente = await pedirTroca({ dias: 5 });
    const recusada = await pedirTroca({ dias: 6 });
    await acao(maria, recusada.id, "recusar");

    const recebidas = await api("GET", "/solicitacoes-troca/recebidas", { cookie: maria.cookie });
    expect(recebidas.json.solicitacoes.map((s: any) => s.id)).toEqual([pendente.id]);
    expect((await api("GET", "/solicitacoes-troca/recebidas", { cookie: joao.cookie })).json.solicitacoes).toEqual([]);

    const enviadas = await api("GET", "/solicitacoes-troca/enviadas", { cookie: joao.cookie });
    expect(enviadas.json.solicitacoes.map((s: any) => s.id).sort()).toEqual([pendente.id, recusada.id].sort());
  });

  test("supervisor filtra por status; status inválido: 400", async () => {
    const pendente = await pedirTroca({ dias: 5 });
    const aguardando = await pedirTroca({ dias: 6 });
    await acao(maria, aguardando.id, "aceitar");

    const todas = await api("GET", "/solicitacoes-troca", { cookie: supervisor.cookie });
    expect(todas.json.solicitacoes).toHaveLength(2);

    const filtradas = await api("GET", "/solicitacoes-troca?status=aguardando_aprovacao", { cookie: supervisor.cookie });
    expect(filtradas.json.solicitacoes.map((s: any) => s.id)).toEqual([aguardando.id]);
    expect(pendente.id).not.toBe(aguardando.id);

    expect((await api("GET", "/solicitacoes-troca?status=qualquer", { cookie: supervisor.cookie })).status).toBe(400);
  });
});
