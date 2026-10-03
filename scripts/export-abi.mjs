// Copies the compiled Symbolon ABI and deployments into packages/sdk so TS code never hand-writes an ABI.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
const art = JSON.parse(readFileSync("contracts/out/Symbolon.sol/Symbolon.json", "utf8"));
mkdirSync("packages/sdk/src/generated", { recursive: true });
writeFileSync("packages/sdk/src/generated/abi.ts", `export const symbolonAbi = ${JSON.stringify(art.abi, null, 2)} as const;\n`);
const deployments = {};
for (const f of readdirSync("contracts/deployments")) deployments[f.replace(".json", "")] = JSON.parse(readFileSync(`contracts/deployments/${f}`, "utf8"));
writeFileSync("packages/sdk/src/generated/deployments.ts", `export const deployments = ${JSON.stringify(deployments, null, 2)} as const;\n`);
console.log("abi + deployments exported:", Object.keys(deployments).join(", "));
