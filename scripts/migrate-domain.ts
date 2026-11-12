import { migrarDominio } from "../src/db/migrate";
import { pool } from "../src/lib/db";

await migrarDominio();
await pool.end();

console.log("Domain schema (funcionario, supervisor, turno, solicitacao_troca_turno) applied.");
