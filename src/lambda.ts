// Entry point de produção (Lambda Web Functions, Node 24). Carrega os segredos do SSM Parameter
// Store antes de importar a aplicação, porque db.ts e auth.ts leem process.env ao carregar.
import { GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";

const SEGREDOS = ["DATABASE_URL", "BETTER_AUTH_SECRET"] as const;

async function carregarSegredos(prefixo: string): Promise<void> {
  const base = prefixo.endsWith("/") ? prefixo : `${prefixo}/`;
  const ssm = new SSMClient({});
  const { Parameters = [], InvalidParameters = [] } = await ssm.send(
    new GetParametersCommand({ Names: SEGREDOS.map((nome) => `${base}${nome}`), WithDecryption: true }),
  );

  if (InvalidParameters.length > 0) {
    throw new Error(`Parâmetros não encontrados no SSM: ${InvalidParameters.join(", ")}`);
  }

  for (const parametro of Parameters) {
    const nome = parametro.Name?.slice(base.length);
    if (nome && parametro.Value !== undefined) {
      process.env[nome] = parametro.Value;
    }
  }
}

const prefixo = process.env.SSM_PREFIX;
if (prefixo) {
  await carregarSegredos(prefixo);
}

await import("./index");
