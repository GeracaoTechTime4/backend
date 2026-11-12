import * as z from "zod";

// Configuração da aplicação, validada uma vez ao carregar. Uma variável faltando ou inválida
// derruba a inicialização com uma mensagem clara, em vez de aparecer como erro em tempo de execução.
//
// No Lambda este módulo só pode ser importado depois de src/lambda.ts carregar os segredos do SSM
// (por isso lá a aplicação é importada dinamicamente).

const booleano = z
  .enum(["true", "false"])
  .default("false")
  .transform((valor) => valor === "true");

const listaDeOrigens = z
  .string()
  .default("")
  .transform((valor, ctx) => {
    const origens = valor
      .split(",")
      .map((origem) => origem.trim().replace(/\/+$/, ""))
      .filter(Boolean);
    for (const origem of origens) {
      if (!URL.canParse(origem) || new URL(origem).origin !== origem) {
        ctx.addIssue({ code: "custom", message: `origem inválida: "${origem}" (use esquema://host[:porta])` });
      }
    }
    return origens;
  });

const fusoHorario = z.string().refine((fuso) => {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}, "fuso horário inválido");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    // Vazio ou "pglite:<diretório>" = PGlite embutido (só desenvolvimento).
    DATABASE_URL: z.string().optional(),
    BETTER_AUTH_SECRET: z.string().min(32, "precisa ter pelo menos 32 caracteres").optional(),
    BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
    // Origens extras do front além de http://localhost:5173 (lista separada por vírgula).
    CORS_ORIGIN: listaDeOrigens,
    CROSS_SITE_COOKIES: booleano,
    AUTH_RATE_LIMIT: booleano,
    // Consulta ao HaveIBeenPwned no cadastro (rede externa). Só os testes desligam; produção exige ligado.
    AUTH_CHECK_PWNED: z
      .enum(["true", "false"])
      .default("true")
      .transform((valor) => valor === "true"),
    APP_TZ: fusoHorario.default("America/Sao_Paulo"),
    PG_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
    // Valor do header que o CloudFront envia para a API (src/lib/origin-verify.ts). Vazio = não verifica.
    ORIGIN_SECRET: z.string().min(32, "precisa ter pelo menos 32 caracteres").optional(),
    // Dimensões das métricas EMF (src/lib/metricas.ts). APP_ENV vem de config/env/<ambiente>.json e
    // APP_VERSION é gravado pelo pipeline em cada revisão. Sem os dois, nenhuma métrica é publicada.
    APP_ENV: z.string().optional(),
    APP_VERSION: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;

    if (!env.DATABASE_URL?.startsWith("postgres")) {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "precisa apontar para um Postgres (postgresql://...) em produção",
      });
    }
    if (!env.BETTER_AUTH_SECRET) {
      ctx.addIssue({ code: "custom", path: ["BETTER_AUTH_SECRET"], message: "obrigatório em produção" });
    }
    if (!env.AUTH_CHECK_PWNED) {
      ctx.addIssue({ code: "custom", path: ["AUTH_CHECK_PWNED"], message: "não pode ser desligado em produção" });
    }
    if (!process.env.BETTER_AUTH_URL) {
      ctx.addIssue({ code: "custom", path: ["BETTER_AUTH_URL"], message: "obrigatório em produção" });
    }
  });

// Campos lidos um a um (e não `schema.parse(process.env)`): o build do Lambda substitui
// `process.env.NODE_ENV` por "production" em tempo de compilação, e isso só funciona com o acesso direto.
const resultado = schema.safeParse({
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL || undefined,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || undefined,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || undefined,
  CORS_ORIGIN: process.env.CORS_ORIGIN,
  CROSS_SITE_COOKIES: process.env.CROSS_SITE_COOKIES || undefined,
  AUTH_RATE_LIMIT: process.env.AUTH_RATE_LIMIT || undefined,
  AUTH_CHECK_PWNED: process.env.AUTH_CHECK_PWNED || undefined,
  APP_TZ: process.env.APP_TZ || undefined,
  PG_POOL_MAX: process.env.PG_POOL_MAX || undefined,
  ORIGIN_SECRET: process.env.ORIGIN_SECRET || undefined,
  APP_ENV: process.env.APP_ENV || undefined,
  APP_VERSION: process.env.APP_VERSION || undefined,
});

if (!resultado.success) {
  const problemas = resultado.error.issues.map((issue) => `  - ${issue.path.join(".") || "(raiz)"}: ${issue.message}`);
  throw new Error(`Configuração inválida:\n${problemas.join("\n")}`);
}

export const config = resultado.data;
