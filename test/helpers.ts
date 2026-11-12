import { PromoverSupervisorUseCase } from "../src/lib/promover-supervisor";
import { pool } from "../src/lib/db";

const app = (await import("../src/index")).default;

export const SENHA = "senha-de-teste-123";
export const ORIGEM = "http://localhost:5173";

export interface Cliente {
  id: string;
  email: string;
  nome: string;
  cookie: string;
  /** IP de onde o cliente "vem" (vira CloudFront-Viewer-Address): cada cliente tem o seu contador de rate limit. */
  ip: string;
}

interface Opcoes {
  corpo?: unknown;
  /** Corpo cru (para testar JSON inválido). */
  corpoCru?: string;
  cookie?: string;
  ip?: string;
  headers?: Record<string, string>;
}

let sequencia = 0;
const proximo = () => ++sequencia;

/** IP único por chamada, no formato que o CloudFront envia (o app tira a porta). */
export function novoIp(): string {
  const n = proximo();
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

/** Chama a API em processo (sem servidor), como o CloudFront chamaria. */
export async function api(metodo: string, caminho: string, opcoes: Opcoes = {}) {
  const headers: Record<string, string> = {
    Origin: ORIGEM,
    "CloudFront-Viewer-Address": `${opcoes.ip ?? novoIp()}:1234`,
    ...opcoes.headers,
  };
  if (opcoes.cookie) headers.Cookie = opcoes.cookie;

  let body: string | undefined;
  if (opcoes.corpoCru !== undefined) {
    body = opcoes.corpoCru;
    headers["Content-Type"] = "application/json";
  } else if (opcoes.corpo !== undefined) {
    body = JSON.stringify(opcoes.corpo);
    headers["Content-Type"] = "application/json";
  }

  const resposta = await app.fetch(new Request(`http://localhost:3000${caminho}`, { method: metodo, headers, body }));
  const texto = await resposta.text();
  let json: any = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = texto;
  }
  return { status: resposta.status, json, headers: resposta.headers };
}

/** `Cookie` a partir dos `Set-Cookie` de uma resposta. */
export function cookieDe(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

export async function cadastrar(nome?: string, opcoes: { ip?: string; corpoExtra?: object } = {}) {
  const n = proximo();
  const email = `pessoa${n}@example.com`;
  const nomeFinal = nome ?? `Pessoa ${n}`;
  const ip = opcoes.ip ?? novoIp();
  const r = await api("POST", "/api/auth/sign-up/email", {
    corpo: { name: nomeFinal, email, password: SENHA, ...opcoes.corpoExtra },
    ip,
  });
  return { ...r, email, nome: nomeFinal, ip };
}

export async function login(email: string, ip = novoIp(), senha = SENHA) {
  const r = await api("POST", "/api/auth/sign-in/email", { corpo: { email, password: senha }, ip });
  return { ...r, cookie: cookieDe(r.headers) };
}

export async function cadastrarFuncionario(nome?: string): Promise<Cliente> {
  const r = await cadastrar(nome);
  if (r.status !== 200) throw new Error(`cadastro falhou: ${r.status} ${JSON.stringify(r.json)}`);
  return { id: r.json.user.id, email: r.email, nome: r.nome, cookie: cookieDe(r.headers), ip: r.ip };
}

/** Cadastra, promove (como o script `supervisor:promover`) e só então faz login: a sessão já nasce com o papel novo. */
export async function cadastrarSupervisor(nome = "Supervisora"): Promise<Cliente> {
  const r = await cadastrar(nome);
  if (r.status !== 200) throw new Error(`cadastro falhou: ${r.status} ${JSON.stringify(r.json)}`);
  const promovido = await new PromoverSupervisorUseCase(pool).execute({ email: r.email });
  if (promovido.isFail()) throw new Error(`promoção falhou: ${promovido.error.message}`);
  const l = await login(r.email, r.ip);
  if (l.status !== 200) throw new Error(`login falhou: ${l.status}`);
  return { id: r.json.user.id, email: r.email, nome: r.nome, cookie: l.cookie, ip: r.ip };
}

/** Data (YYYY-MM-DD) daqui a `dias` dias, em UTC. Com dias >= 2 o turno está sempre no futuro em APP_TZ. */
export function dataDaqui(dias: number): string {
  return new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
}

export async function criarTurno(
  supervisor: Cliente,
  funcionario: Cliente,
  { dias = 7, inicio = "08:00", fim = "16:00" }: { dias?: number; inicio?: string; fim?: string } = {},
) {
  const r = await api("POST", "/turnos", {
    cookie: supervisor.cookie,
    corpo: { data: dataDaqui(dias), horaInicio: inicio, horaFim: fim, funcionarioId: funcionario.id },
  });
  if (r.status !== 201) throw new Error(`criar turno falhou: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.turno as { id: string; data: string; horaInicio: string; horaFim: string; funcionarioId: string };
}

export async function solicitar(de: Cliente, turnoId: string, para: Cliente) {
  return api("POST", "/solicitacoes-troca", { cookie: de.cookie, corpo: { turnoId, destinatarioId: para.id } });
}

/** Apaga tudo (domínio e Better Auth, inclusive os contadores de rate limit). */
export async function limparBanco() {
  await pool.query(
    `TRUNCATE solicitacao_troca_turno, turno, funcionario, supervisor, "session", "account", "verification", "rateLimit", "user" CASCADE`,
  );
}

export { pool };
