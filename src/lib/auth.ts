import { betterAuth } from "better-auth";
import { pool } from "./db";
import { criarFuncionario, criarSupervisor } from "./shift-swap";

const trustedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      role: {
        type: ["SUPERVISOR", "EMPLOYEE"],
        required: true,
        input: true,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const role = (user as typeof user & { role: "SUPERVISOR" | "EMPLOYEE" }).role;
          const input = { id: user.id, name: user.name, email: user.email };

          const result =
            role === "SUPERVISOR" ? await criarSupervisor.execute(input) : await criarFuncionario.execute(input);

          if (result.isFailure) {
            throw new Error(`Failed to create ${role} record for user ${user.id}: ${result.error}`);
          }
        },
      },
    },
  },
});
