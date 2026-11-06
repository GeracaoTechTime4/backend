import * as cdk from "aws-cdk-lib";
import { type ShiftSwapEnvironment, ShiftSwapStack } from "../lib/shift-swap-stack.ts";

const app = new cdk.App();

const account = "666600766236";
const region = "us-east-1";

const environments: ShiftSwapEnvironment[] = [
  {
    name: "staging",
    githubEnvironment: "staging",
    domainName: "so-staging.mariochaves.click",
    aliases: ["so-staging.mariochaves.click"],
    dnsRecords: [{ id: "Alias", name: "so-staging.mariochaves.click" }],
    maxEnvironments: 2,
    // Valores aceitos: 0, 100, 200, ..., 1000, 2000, ..., 10000.
    rateLimit: 100,
  },
  {
    name: "prod",
    githubEnvironment: "production",
    domainName: "so.mariochaves.click",
    // Migrado da distribuição antiga (E3QT1JW59DWN5A) sem queda; o roteiro está em infra/cdk/README.md.
    aliases: ["so.mariochaves.click"],
    dnsRecords: [{ id: "Alias", name: "so.mariochaves.click" }],
    maxEnvironments: 2,
    rateLimit: 100,
  },
];

for (const environment of environments) {
  new ShiftSwapStack(app, `ShiftSwap-${environment.name}`, {
    env: { account, region },
    environment,
    description: `shift-swap (${environment.name}): API, front, CloudFront, DNS e roles de deploy`,
    // Curinga *.mariochaves.click (us-east-1), o mesmo usado hoje.
    certificateArn: `arn:aws:acm:${region}:${account}:certificate/eac4f9b5-911a-42b8-b62e-f3031156b0b8`,
    hostedZoneId: "Z08866322JDTTUZKNDJUQ",
    hostedZoneName: "mariochaves.click",
    backendSubPrefix: "repo:GeracaoTechTime4@330860588/backend@1376465255",
    frontendSubPrefix: "repo:GeracaoTechTime4@330860588/frontend@1376465593",
  });
}
