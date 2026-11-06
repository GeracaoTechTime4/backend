import { betterAuth } from "better-auth";
import { haveIBeenPwned } from "better-auth/plugins";
import { config } from "../config";
import { CLIENT_IP_HEADER } from "./client-ip";
import { authDatabase } from "./db";
import { allowedOrigins } from "./origins";
import { criarFuncionario, criarSupervisor } from "./shift-swap";

export const auth = betterAuth({
  database: authDatabase,
  secret: config.BETTER_AUTH_SECRET,
  baseURL: config.BETTER_AUTH_URL,
  trustedOrigins: allowedOrigins,
  advanced: {
    ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    // Front em outro site (ex.: front na Vercel e API no domínio do Lambda): o navegador só envia o
    // cookie de sessão em requisições cross-site com SameSite=None + Secure.
    ...(config.CROSS_SITE_COOKIES && {
      defaultCookieAttributes: { sameSite: "none", secure: true },
    }),
  },
  // Limite de tentativas por IP. Fica no banco porque no Lambda cada instância tem a sua memória
  // e a perde no cold start. Ligado em produção; AUTH_RATE_LIMIT=true liga também localmente.
  rateLimit: {
    enabled: config.NODE_ENV === "production" || config.AUTH_RATE_LIMIT,
    storage: "database",
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 3600, max: 10 },
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  // Recusa no cadastro e na troca de senha as senhas que já apareceram em vazamentos.
  plugins: [haveIBeenPwned()],
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
