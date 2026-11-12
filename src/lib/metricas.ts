import type { MiddlewareHandler } from "hono";

// Métricas por requisição no formato EMF (embedded metric format): uma linha JSON no stdout que o
// CloudWatch transforma em métrica. As métricas nativas da Web Function não têm latência nem
// separam por revisão; estas têm as duas coisas, e o canary do deploy (deploy.yml) depende delas.
//
// Dimensões: [Environment] para os alarmes do CDK e [Environment, Version] para comparar a revisão
// nova com a anterior. Version vem de APP_VERSION, gravado pelo pipeline em cada revisão.
export const NAMESPACE_METRICAS = "ShiftSwap/Api";

/**
 * Publica Requests, Errors5xx e Latency de cada requisição. Sem `ambiente` ou `versao`
 * (desenvolvimento local, Docker) não publica nada.
 *
 * O EMF precisa ir direto para o stdout: o Lambda embrulha a saída do `console` num evento próprio,
 * e o CloudWatch não extrai métricas de dentro dele.
 */
export function metricasHttp(ambiente: string | undefined, versao: string | undefined): MiddlewareHandler {
  if (!ambiente || !versao) {
    return async (_c, next) => next();
  }

  return async (c, next) => {
    const inicio = performance.now();
    await next();
    const latencia = Math.round(performance.now() - inicio);
    const status = c.res.status;

    process.stdout.write(
      `${JSON.stringify({
        _aws: {
          Timestamp: Date.now(),
          CloudWatchMetrics: [
            {
              Namespace: NAMESPACE_METRICAS,
              Dimensions: [["Environment"], ["Environment", "Version"]],
              Metrics: [
                { Name: "Requests", Unit: "Count" },
                { Name: "Errors5xx", Unit: "Count" },
                { Name: "Latency", Unit: "Milliseconds" },
              ],
            },
          ],
        },
        Environment: ambiente,
        Version: versao,
        Requests: 1,
        Errors5xx: status >= 500 ? 1 : 0,
        Latency: latencia,
        // Contexto para o Logs Insights (não vira métrica).
        method: c.req.method,
        route: c.req.routePath,
        status,
      })}\n`,
    );
  };
}
