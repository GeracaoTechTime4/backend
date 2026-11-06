import { config } from "../config";

// Origens que podem chamar a API com cookies (CORS) e que o Better Auth aceita (trustedOrigins).
// O front local vale sempre; os domínios de cada ambiente vêm de CORS_ORIGIN (config/env/<ambiente>.json).
const ORIGEM_LOCAL = "http://localhost:5173";

export const allowedOrigins = [...new Set([ORIGEM_LOCAL, ...config.CORS_ORIGIN])];
