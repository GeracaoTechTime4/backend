import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { exigirOrigemCloudFront, ORIGIN_SECRET_HEADER } from "../src/lib/origin-verify";

// O app global dos testes sobe sem ORIGIN_SECRET (src/config.ts é lido uma vez); o middleware é
// testado isolado, num app mínimo.
const SEGREDO = "segredo-de-origem-dos-testes-0123456789abcdef";

function app(segredo: string | undefined) {
  const a = new Hono();
  a.use("*", exigirOrigemCloudFront(segredo));
  a.get("/health", (c) => c.text("ok"));
  a.get("/turnos", (c) => c.text("ok"));
  return a;
}

const get = (a: Hono, caminho: string, valor?: string) =>
  a.request(caminho, { headers: valor === undefined ? {} : { [ORIGIN_SECRET_HEADER]: valor } });

describe("com segredo", () => {
  const a = app(SEGREDO);

  test("sem o header: 403", async () => {
    expect((await get(a, "/turnos")).status).toBe(403);
  });

  test("com valor errado ou de outro tamanho: 403", async () => {
    expect((await get(a, "/turnos", "chute")).status).toBe(403);
    expect((await get(a, "/turnos", `${SEGREDO}x`)).status).toBe(403);
  });

  test("com o valor certo: passa", async () => {
    expect((await get(a, "/turnos", SEGREDO)).status).toBe(200);
  });

  test("/health fica liberado", async () => {
    expect((await get(a, "/health")).status).toBe(200);
  });
});

test("sem segredo (desenvolvimento): não verifica", async () => {
  expect((await get(app(undefined), "/turnos")).status).toBe(200);
});
