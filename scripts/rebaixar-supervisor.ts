import { pool } from "../src/lib/db";
import { RebaixarSupervisorUseCase } from "../src/lib/rebaixar-supervisor";

// Uso: bun run supervisor:rebaixar <email>   (prod: bun run supervisor:rebaixar:prod <email>)
const email = process.argv[2];
if (!email) {
  console.error("Uso: bun run supervisor:rebaixar <email>");
  process.exit(1);
}

const result = await new RebaixarSupervisorUseCase(pool).execute({ email });
await pool.end();

if (result.isFail()) {
  console.error(`Não rebaixado (${result.error.code}): ${result.error.message}`, result.error.cause ?? "");
  process.exit(1);
}

console.log(`Funcionário: ${email} (id ${result.value.id})`);
