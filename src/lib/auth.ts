import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { haveIBeenPwned } from "better-auth/plugins";
import { FuncionarioEntity } from "shift-swap";
import { config } from "../config";
import { CLIENT_IP_HEADER } from "./client-ip";
import { authDatabase } from "./db";
import { allowedOrigins } from "./origins";
import { criarFuncionario } from "./shift-swap";

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
      // O papel é do servidor: o cadastro público sempre cria EMPLOYEE e um `role` enviado no corpo é
      // ignorado. Supervisores são promovidos por src/lib/promover-supervisor.ts (seed e script).
      role: {
        type: ["SUPERVISOR", "EMPLOYEE"],
        required: false,
        defaultValue: "EMPLOYEE",
        input: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // Valida nome e e-mail com as regras do domínio antes de criar o usuário: uma falha no
          // `after` (já com o usuário gravado) virava 500. O Better Auth exige `throw` aqui para
          // abortar; o APIError vira 400 com o mesmo formato de erro das rotas do domínio.
          const funcionario = FuncionarioEntity.create({ name: user.name, email: user.email });
          if (funcionario.isFail()) {
            const { issues } = funcionario.error;
            throw new APIError("BAD_REQUEST", {
              message: issues.map((issue) => issue.message).join("; "),
              code: issues.length === 1 ? issues[0]?.code : funcionario.error.code,
              issues,
            });
          }
          // Reforço além do `input: false`: nenhum caminho de criação de usuário gera supervisor.
          // O nome é gravado como o domínio o normaliza (sem espaços nas pontas).
          return { data: { ...user, name: funcionario.value.name.value, role: "EMPLOYEE" } };
        },
        after: async (user) => {
          const result = await criarFuncionario.execute({ id: user.id, name: user.name, email: user.email });

          if (result.isFail()) {
            throw new Error(`Failed to create EMPLOYEE record for user ${user.id}: ${result.error.message}`, {
              cause: result.error,
            });
          }
        },
      },
    },
  },
});
