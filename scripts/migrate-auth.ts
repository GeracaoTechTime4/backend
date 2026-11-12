import { migrarAuth } from "../src/db/migrate";
import { pool } from "../src/lib/db";

console.log((await migrarAuth()) ? "Better Auth schema migrated." : "Better Auth schema already up to date.");

await pool.end();
