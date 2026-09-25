import { auth } from "../src/lib/auth";
import { pool } from "../src/lib/db";
import { criarTurno } from "../src/lib/shift-swap";

const SEED_PASSWORD = "password123";

interface SeedUser {
  name: string;
  email: string;
  role: "SUPERVISOR" | "EMPLOYEE";
}

const supervisor: SeedUser = { name: "Ana Supervisora", email: "supervisor@example.com", role: "SUPERVISOR" };
const joao: SeedUser = { name: "João Funcionário", email: "joao@example.com", role: "EMPLOYEE" };
const maria: SeedUser = { name: "Maria Funcionária", email: "maria@example.com", role: "EMPLOYEE" };
const funcionarios = [joao, maria];

async function ensureUser(seedUser: SeedUser): Promise<string> {
  try {
    const { user } = await auth.api.signUpEmail({
      body: { name: seedUser.name, email: seedUser.email, password: SEED_PASSWORD, role: seedUser.role },
    });
    console.log(`  criado: ${seedUser.email} (${seedUser.role}) - id ${user.id}`);
    return user.id;
  } catch {
    const result = await pool.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [seedUser.email]);
    const existing = result.rows[0];
    if (!existing) {
      throw new Error(`Não consegui criar nem encontrar o usuário ${seedUser.email}`);
    }
    console.log(`  já existia: ${seedUser.email} (${seedUser.role}) - id ${existing.id}`);
    return existing.id;
  }
}

function addDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

console.log("Criando usuários...");
const supervisorId = await ensureUser(supervisor);
const joaoId = await ensureUser(joao);
const mariaId = await ensureUser(maria);

console.log("Criando turnos...");
const turnosSeed = [
  { data: addDays(0), horaInicio: "08:00", horaFim: "16:00", funcionarioId: joaoId },
  { data: addDays(1), horaInicio: "08:00", horaFim: "16:00", funcionarioId: joaoId },
  { data: addDays(0), horaInicio: "16:00", horaFim: "23:59", funcionarioId: mariaId },
];

for (const turno of turnosSeed) {
  const result = await criarTurno.execute(turno);
  if (result.isFailure) {
    console.error(`  falha ao criar turno (${turno.data} ${turno.horaInicio}-${turno.horaFim}): ${result.error}`);
  } else {
    console.log(`  turno criado: ${result.getValue().id} (${turno.data} ${turno.horaInicio}-${turno.horaFim})`);
  }
}

console.log(`\nCredenciais de teste (senha para todos: ${SEED_PASSWORD}):`);
console.log(`  Supervisor: ${supervisor.email} (id ${supervisorId})`);
for (const f of funcionarios) {
  console.log(`  Funcionário: ${f.email}`);
}

await pool.end();
