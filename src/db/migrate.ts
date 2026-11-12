import { getMigrations } from "better-auth/db/migration";
import { auth } from "../lib/auth";
import { pool } from "../lib/db";

/** Tabelas do Better Auth. Devolve true se algo foi criado ou alterado. */
export async function migrarAuth(): Promise<boolean> {
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
  if (toBeCreated.length === 0 && toBeAdded.length === 0) return false;
  await runMigrations();
  return true;
}

/** Schema do domínio (idempotente). Depende das tabelas do Better Auth (FKs para "user"). */
export async function migrarDominio(): Promise<void> {
  const schema = await Bun.file(new URL("./schema.sql", import.meta.url)).text();
  await pool.query(schema);
}

/** Tudo, na ordem certa. Não fecha o pool: quem chama decide (scripts fecham, testes não). */
export async function migrar(): Promise<void> {
  await migrarAuth();
  await migrarDominio();
}
