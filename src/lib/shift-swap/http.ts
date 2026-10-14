import type { AppError, ErrorKind, ValidationError } from "core-kernel";
import type { Context } from "hono";

// O shift-swap devolve erros tipados: o status HTTP vem do `kind`, não do texto da mensagem.
const STATUS: Record<ErrorKind, 400 | 403 | 404 | 409 | 500> = {
  validation: 400,
  not_found: 404,
  conflict: 409,
  forbidden: 403,
  unexpected: 500,
};

/**
 * Resposta de erro da API: `error` continua sendo o texto (contrato do frontend) e `code` é o
 * código estável do shift-swap (ex.: `TURNO_NAO_ENCONTRADO`). Em validação, `code` é o da issue
 * quando há uma só (ex.: `DATA_INVALIDA`; o do erro seria o genérico `VALIDATION_FAILED`) e
 * `issues` traz todas. Falhas inesperadas (banco fora do ar etc.) são logadas com a causa e não
 * expõem detalhes ao cliente.
 */
export function respostaDeErro(c: Context, error: AppError) {
  if (error.kind === "unexpected") {
    console.error("Erro inesperado:", error.message, error.cause);
    return c.json({ error: "Erro interno", code: error.code }, 500);
  }
  if (isValidationError(error)) {
    const [unica, ...outras] = error.issues;
    const code = unica && outras.length === 0 ? unica.code : error.code;
    return c.json({ error: error.message, code, issues: error.issues }, 400);
  }
  return c.json({ error: error.message, code: error.code }, STATUS[error.kind]);
}

function isValidationError(error: AppError): error is ValidationError {
  return error.kind === "validation";
}

/** Código de erro do Postgres na causa de uma falha inesperada (ex.: "23503" = foreign key). */
export function codigoPostgres(error: AppError): string | undefined {
  if (error.kind !== "unexpected") return undefined;
  return (error.cause as { code?: string } | undefined)?.code;
}
