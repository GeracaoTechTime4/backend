import { pool } from "../src/lib/db";

const schema = await Bun.file(new URL("../src/db/schema.sql", import.meta.url)).text();

await pool.query(schema);
await pool.end();

console.log("Domain schema (funcionario, supervisor) applied.");
