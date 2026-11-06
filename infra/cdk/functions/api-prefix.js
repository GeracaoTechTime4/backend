// Viewer request do comportamento /api/*: a API nao conhece o prefixo /api, entao ele e removido
// antes de a requisicao seguir para a Lambda Web Function. (Sem acentos: este codigo vai para o template.)
function handler(event) {
  var request = event.request;
  request.uri = request.uri.replace(/^\/api/, '') || '/';
  return request;
}
