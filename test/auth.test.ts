import { beforeEach, describe, expect, test } from "bun:test";
import { api, cadastrar, cookieDe, login, novoIp, pool, SENHA, limparBanco } from "./helpers";

beforeEach(limparBanco);

async function contar(sql: string, params: unknown[]) {
  const { rows } = await pool.query<{ n: string | number }>(sql, params);
  return Number(rows[0]?.n);
}

describe("cadastro", () => {
  test("cria o usuário como EMPLOYEE e o registro de funcionário com o mesmo id", async () => {
    const r = await cadastrar("Ana Lima");
    expect(r.status).toBe(200);
    expect(r.json.user.role).toBe("EMPLOYEE");
    expect(await contar("SELECT count(*) AS n FROM funcionario WHERE id = $1", [r.json.user.id])).toBe(1);
  });

  test('um "role": "SUPERVISOR" no corpo é ignorado', async () => {
    const r = await cadastrar("Invasor", { corpoExtra: { role: "SUPERVISOR" } });
    expect(r.status).toBe(200);
    expect(r.json.user.role).toBe("EMPLOYEE");
    expect(await contar("SELECT count(*) AS n FROM supervisor WHERE id = $1", [r.json.user.id])).toBe(0);

    const sessao = await api("GET", "/api/auth/get-session", { cookie: cookieDe(r.headers) });
    expect(sessao.json.user.role).toBe("EMPLOYEE");
  });

  test("nome fora das regras do domínio: 400 com code e issues, e nenhum usuário criado", async () => {
    const r = await cadastrar("A");
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("NOME_CURTO");
    expect(r.json.issues).toHaveLength(1);
    expect(await contar(`SELECT count(*) AS n FROM "user" WHERE email = $1`, [r.email])).toBe(0);
  });

  test("nome com espaços nas pontas é gravado sem eles", async () => {
    const r = await cadastrar("  Bruno Reis  ");
    expect(r.status).toBe(200);
    expect(r.json.user.name).toBe("Bruno Reis");
  });

  test("e-mail já cadastrado é recusado", async () => {
    const primeiro = await cadastrar("Carla Dias");
    const repetido = await api("POST", "/api/auth/sign-up/email", {
      corpo: { name: "Carla Dias", email: primeiro.email, password: SENHA },
    });
    expect(repetido.status).toBeGreaterThanOrEqual(400);
    expect(repetido.status).toBeLessThan(500);
  });
});

describe("sessão", () => {
  test("login, sessão e logout", async () => {
    const { email } = await cadastrar("Diego Melo");

    const errado = await login(email, novoIp(), "senha-errada-999");
    expect(errado.status).toBe(401);

    const ok = await login(email);
    expect(ok.status).toBe(200);
    expect(ok.cookie).toContain("session_token");

    const sessao = await api("GET", "/api/auth/get-session", { cookie: ok.cookie });
    expect(sessao.json.user.email).toBe(email);

    expect((await api("GET", "/turnos/meus", { cookie: ok.cookie })).status).toBe(200);
    expect((await api("POST", "/api/auth/sign-out", { cookie: ok.cookie, corpo: {} })).status).toBe(200);
    expect((await api("GET", "/turnos/meus", { cookie: ok.cookie })).status).toBe(401);
  });

  test("get-session sem cookie devolve null", async () => {
    const r = await api("GET", "/api/auth/get-session");
    expect(r.status).toBe(200);
    expect(r.json).toBeNull();
  });
});

describe("limite de tentativas (por IP do CloudFront-Viewer-Address)", () => {
  test("o 6º login no mesmo minuto e do mesmo IP recebe 429; outro IP continua passando", async () => {
    const { email } = await cadastrar("Elisa Prado");
    const ip = novoIp();
    for (let i = 0; i < 5; i++) {
      expect((await login(email, ip, "senha-errada-999")).status).toBe(401);
    }
    expect((await login(email, ip, "senha-errada-999")).status).toBe(429);
    expect((await login(email, novoIp())).status).toBe(200);
  });

  test("um x-shift-swap-client-ip enviado pelo cliente não troca de contador", async () => {
    const { email } = await cadastrar("Fábio Nunes");
    const ip = novoIp();
    for (let i = 0; i < 5; i++) {
      await login(email, ip, "senha-errada-999");
    }
    const burla = await api("POST", "/api/auth/sign-in/email", {
      corpo: { email, password: SENHA },
      ip,
      headers: { "x-shift-swap-client-ip": "203.0.113.9" },
    });
    expect(burla.status).toBe(429);
  });
});
