// Viewer request do front (SPA): rotas sem extensao de arquivo devolvem o index.html, e o
// roteador do front resolve a rota no navegador. (Sem acentos: este codigo vai para o template.)
function handler(event) {
  var request = event.request;
  if (request.uri.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}
