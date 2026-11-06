import { betterAuth } from "better-auth";
import { authDatabase } from "./db";
import { allowedOrigins } from "./origins";
import { criarFuncionario, criarSupervisor } from "./shift-swap";

export const auth = betterAuth({
  database: authDatabase,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  trustedOrigins: allowedOrigins,
  // Front em outro site (ex.: front na Vercel e API no domínio do Lambda): o navegador só envia o
  // cookie de sessão em requisições cross-site com SameSite=None + Secure.
  ...(process.env.CROSS_SITE_COOKIES === "true" && {
    advanced: {
      defaultCookieAttributes: { sameSite: "none", secure: true },
    },
  }),
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

          if (result.isFail()) {
            throw new Error(`Failed to create ${role} record for user ${user.id}: ${result.error.message}`, {
              cause: result.error,
            });
          }
        },
      },
    },
  },
});
