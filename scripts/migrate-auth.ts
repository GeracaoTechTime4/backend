import { getMigrations } from "better-auth/db/migration";
import { auth } from "../src/lib/auth";
import { pool } from "../src/lib/db";

const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);

if (toBeCreated.length === 0 && toBeAdded.length === 0) {
  console.log("Better Auth schema already up to date.");
} else {
  await runMigrations();
  console.log("Better Auth schema migrated.");
}

await pool.end();
