// Revisão de bootstrap: o endpoint de uma Web Function só pode ser criado apontando para uma
// revisão. Esta responde 503 em tudo (inclusive /health, para nenhum smoke test passar por engano)
// até o pipeline publicar a primeira revisão real e mover o tráfego para ela.
import { createServer } from "node:http";

const [hostname = "0.0.0.0", port = "3000"] = (process.env.AWS_LAMBDA_HTTP_ENDPOINT ?? "0.0.0.0:3000").split(":");

createServer((_req, res) => {
  res.writeHead(503, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Nenhuma versão da API foi publicada neste ambiente ainda" }));
}).listen(Number(port), hostname);
