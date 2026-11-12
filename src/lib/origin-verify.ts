import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

// Header que o CloudFront envia para a origem (origin custom header, ver infra/cdk). Se o visitante
// mandar um header com o mesmo nome, o CloudFront sobrescreve o valor.
export const ORIGIN_SECRET_HEADER = "x-origin-verify";

// Rotas liberadas sem o header: a sonda do runtime chega direto, sem passar pelo CloudFront.
const ROTAS_LIVRES = new Set(["/health"]);

const digest = (valor: string) => createHash("sha256").update(valor).digest();

/**
 * Recusa (403) requisições que não vieram pelo CloudFront.
 *
 * O endpoint da Web Function (*.lambda-web...on.aws) é público. Quem o chama direto consegue
 * forjar CloudFront-Viewer-Address e escapar do limite de tentativas por IP (src/lib/client-ip.ts).
 * Sem `segredo` (desenvolvimento local, Docker) não verifica nada.
 */
export function exigirOrigemCloudFront(segredo: string | undefined): MiddlewareHandler {
  if (!segredo) {
    return async (_c, next) => next();
  }

  const esperado = digest(segredo);

  return async (c, next) => {
    if (ROTAS_LIVRES.has(c.req.path)) {
      return next();
    }

    const recebido = c.req.header(ORIGIN_SECRET_HEADER);
    if (!recebido || !timingSafeEqual(digest(recebido), esperado)) {
      return c.json({ error: "Forbidden" }, 403);
    }

    return next();
  };
}
