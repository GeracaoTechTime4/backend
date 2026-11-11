import { pool } from "../src/lib/db";
import { PromoverSupervisorUseCase } from "../src/lib/promover-supervisor";

// Uso: bun run supervisor:promover <email>   (prod: bun run supervisor:promover:prod <email>)
const email = process.argv[2];
if (!email) {
  console.error("Uso: bun run supervisor:promover <email>");
  process.exit(1);
}

const result = await new PromoverSupervisorUseCase(pool).execute({ email });
await pool.end();

if (result.isFail()) {
  console.error(`Não promovido (${result.error.code}): ${result.error.message}`, result.error.cause ?? "");
  process.exit(1);
}

console.log(`Supervisor: ${email} (id ${result.value.id})`);
