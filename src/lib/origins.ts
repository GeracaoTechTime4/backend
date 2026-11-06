// Origens que podem chamar a API com cookies (CORS) e que o Better Auth aceita (trustedOrigins).
// As de DEFAULT_ORIGINS valem sempre: o front local e os domínios da distribuição do CloudFront
// que serve front e API. CORS_ORIGIN (lista separada por vírgula) acrescenta outras.
const DEFAULT_ORIGINS = [
  "http://localhost:5173",
  "https://dkrzib6ua831y.cloudfront.net",
  "https://so.mariochaves.click",
];

const extraOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

export const allowedOrigins = [...new Set([...DEFAULT_ORIGINS, ...extraOrigins])];
