import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Pool } from "pg";
import { config } from "../config";

/** O que os repositórios usam do banco: serve tanto para o Postgres quanto para o PGlite. */
export interface Db {
  // biome-ignore lint/suspicious/noExplicitAny: mesmo padrão do pg.Pool.query, que os repositórios já usam sem tipar.
  query<R = any>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
  end(): Promise<void>;
}

// Sem DATABASE_URL (ou com `pglite:<diretório>`), usa o PGlite: um Postgres embutido que
// grava em disco e dispensa Docker. Com `postgresql://...`, usa o Postgres de verdade.
// Em produção (Lambda) o disco é efêmero e cada ambiente teria seu próprio PGlite: src/config.ts exige Postgres.
const url = config.DATABASE_URL;
const usaPglite = !url || url.startsWith("pglite:");

async function criarPglite() {
  const { PGlite } = await import("@electric-sql/pglite");
  const { PostgresDialect } = await import("kysely");

  const dataDir = url?.slice("pglite:".length) || "./.data/pglite";

  // `memory://` é o PGlite em memória (testes): não há diretório para criar.
  if (!dataDir.startsWith("memory://")) {
    mkdirSync(dirname(dataDir), { recursive: true });
  }

  // O `bun --hot` reavalia este módulo; guardar a instância evita abrir o mesmo diretório duas vezes.
  const global = globalThis as typeof globalThis & { __pglite?: InstanceType<typeof PGlite> };
  const client = (global.__pglite ??= new PGlite(dataDir));
  await client.waitReady;

  const fechar = () => client.close().finally(() => process.exit(0));
  process.once("SIGINT", fechar);
  process.once("SIGTERM", fechar);

  const db: Db = {
    async query<R>(sql: string, params?: unknown[]) {
      // Sem parâmetros usa `exec`, o único que aceita vários comandos (como o schema.sql).
      if (!params) {
        const results = await client.exec(sql);
        return { rows: (results.at(-1)?.rows ?? []) as R[] };
      }
      const result = await client.query<R>(sql, params);
      return { rows: result.rows };
    },
    async end() {
      await client.close();
      global.__pglite = undefined;
    },
  };

  // O PGlite tem uma conexão só: quem pega a "conexão" a segura até liberar, para que
  // transações do Better Auth não se misturem.
  let fila: Promise<void> = Promise.resolve();
  const pool = {
    async connect() {
      const anterior = fila;
      let liberar!: () => void;
      fila = new Promise<void>((resolve) => {
        liberar = resolve;
      });
      await anterior;
      return {
        query: async (sql: string, params: unknown[] = []) => {
          const result = await client.query(sql, params);
          return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
        },
        release: liberar,
      };
    },
    async end() {},
  };

  // biome-ignore lint/suspicious/noExplicitAny: o Kysely tipa `pool` como pg.Pool; o objeto acima cobre só o que ele usa.
  return { db, authDatabase: { dialect: new PostgresDialect({ pool: pool as any }), type: "postgres" as const } };
}

function criarPostgres() {
  // Várias instâncias da função abrem pools próprios: mantenha cada um pequeno para não
  // estourar o limite de conexões do banco (use a URL "pooled" do Neon/Supabase).
  const pg = new Pool({
    connectionString: url,
    max: config.PG_POOL_MAX,
    idleTimeoutMillis: 30_000,
  });
  const db: Db = {
    async query<R>(sql: string, params?: unknown[]) {
      const result = await pg.query(sql, params);
      return { rows: result.rows as R[] };
    },
    end: () => pg.end(),
  };
  return { db, authDatabase: pg };
}

const { db, authDatabase } = usaPglite ? await criarPglite() : criarPostgres();

export { db as pool, authDatabase };
