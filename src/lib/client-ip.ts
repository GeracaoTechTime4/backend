// Header de onde o Better Auth lê o IP do cliente (advanced.ipAddress.ipAddressHeaders).
export const CLIENT_IP_HEADER = "x-shift-swap-client-ip";

/**
 * Copia o IP do visitante para CLIENT_IP_HEADER antes de a requisição chegar ao Better Auth.
 *
 * Atrás do CloudFront o X-Forwarded-For chega com mais de um IP e o Better Auth o descarta,
 * caindo num contador de tentativas único para todo mundo. O CloudFront envia o IP real em
 * CloudFront-Viewer-Address ("ip:porta"; a origin request policy AllViewerExceptHostHeader o
 * inclui). Um CLIENT_IP_HEADER vindo do cliente é sempre descartado.
 */
export function withClientIp(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete(CLIENT_IP_HEADER);

  const viewerAddress = headers.get("cloudfront-viewer-address");
  const separador = viewerAddress?.lastIndexOf(":") ?? -1;
  if (viewerAddress && separador > 0) {
    headers.set(CLIENT_IP_HEADER, viewerAddress.slice(0, separador).replace(/^\[|\]$/g, ""));
  }

  return new Request(request, { headers });
}
