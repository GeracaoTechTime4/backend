// Viewer request do comportamento /api/*: a API não conhece o prefixo /api, então ele é removido
// antes de a requisição seguir para a Lambda Web Function.
function handler(event) {
  var request = event.request;
  request.uri = request.uri.replace(/^\/api/, '') || '/';
  return request;
}
