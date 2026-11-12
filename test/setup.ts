// Roda antes de cada arquivo de teste importar o app: src/config.ts lê o ambiente uma vez, ao carregar.
// Sobrescreve o que o Bun carregou do .env local, para os testes não dependerem da máquina.
//
// Banco: PGlite em memória por padrão; no CI, TEST_DATABASE_URL aponta para o Postgres do job.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "pglite:memory://";
process.env.BETTER_AUTH_SECRET = "segredo-dos-testes-de-integracao-0123456789";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.CORS_ORIGIN = "";
process.env.CROSS_SITE_COOKIES = "false";
process.env.APP_TZ = "America/Sao_Paulo";
// Sem rede: o cadastro não consulta o HaveIBeenPwned.
process.env.AUTH_CHECK_PWNED = "false";
// Ligado como em produção. Cada cliente dos testes usa um IP próprio (test/helpers.ts), então os
// contadores não se misturam.
process.env.AUTH_RATE_LIMIT = "true";
// O app global sobe sem segredo de origem e sem métricas (o middleware é testado à parte).
delete process.env.ORIGIN_SECRET;
delete process.env.APP_ENV;
delete process.env.APP_VERSION;
delete process.env.SSM_PREFIX;

// Nenhum teste sai para a rede: um fetch externo (ex.: o HaveIBeenPwned voltando a ser chamado)
// falha na hora, em vez de passar ou falhar conforme a conexão da máquina.
const fetchOriginal = globalThis.fetch;
globalThis.fetch = Object.assign(
  (entrada: string | URL | Request, init?: RequestInit) => {
    const url = new URL(entrada instanceof Request ? entrada.url : entrada.toString());
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      return Promise.reject(new Error(`Teste tentou acessar a rede: ${url.origin}`));
    }
    return fetchOriginal(entrada, init);
  },
  fetchOriginal,
);

const { migrar } = await import("../src/db/migrate");
await migrar();
