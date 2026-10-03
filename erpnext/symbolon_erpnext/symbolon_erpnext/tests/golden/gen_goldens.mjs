// Produces goldens.json from the TypeScript SDK (packages/sdk/src/ids.ts), the reference implementation.
// Run: node symbolon_erpnext/tests/golden/gen_goldens.mjs   (Node >= 22.18 strips TS types natively)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sdk = process.env.SYMBOLON_SDK_IDS ?? join(here, "../../../../../packages/sdk/src/ids.ts");
const { canonicalJson, hashRecord, obligationId, payeeId } = await import(sdk);

const docs = JSON.parse(readFileSync(join(here, "documents.json"), "utf8"));
const out = {
  source: "packages/sdk/src/ids.ts",
  documents: docs.map((d) => ({ canonical: canonicalJson(d), hash: hashRecord(d) })),
  obligation_ids: [
    ["Purchase Invoice", "ACC-PINV-SMOKE-0001"],
    ["Salary Slip", "Sal Slip/HR-EMP-00001/00001"],
    ["Purchase Invoice", "ACC-PINV-2026-00001"],
  ].map(([dt, n]) => ({ doctype: dt, name: n, id: obligationId(dt, n) })),
  payee_ids: [
    ["Supplier", "ACME-001"],
    ["Employee", "HR-EMP-00001"],
  ].map(([k, i]) => ({ kind: k, id: i, payee_id: payeeId(k, i) })),
};
writeFileSync(join(here, "goldens.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
