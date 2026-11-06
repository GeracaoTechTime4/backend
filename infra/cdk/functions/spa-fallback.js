// Viewer request do front (SPA): rotas sem extensão de arquivo devolvem o index.html, e o
// roteador do front resolve a rota no navegador.
function handler(event) {
  var request = event.request;
  if (request.uri.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}
