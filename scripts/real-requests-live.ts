// Opt-in live-model half of the real-request set (evals/real-requests.ts). Never run by npm test or the gate; spends nothing itself.
// 1) `node --experimental-strip-types scripts/real-requests-live.ts` prints the run sheet: send each prompt to CORE on a TEST account.
// 2) Record [{ "id": "...", "pass": true|false, "note": "what happened" }] judged against expected/forbidden, then
//    `... scripts/real-requests-live.ts --results runs.json` reports which behaviours regressed. Exit 1 on any failure or missing case.
import { readFileSync } from "node:fs";
import { REAL_REQUESTS } from "../evals/real-requests.ts";

const i = process.argv.indexOf("--results");
if (i < 0) {
  for (const r of REAL_REQUESTS) console.log(`[${r.id}] (${r.lang}) ${r.prompt}\n  expect: ${r.expected}\n  forbidden: ${r.forbidden}\n`);
  process.exit(0);
}
const runs = JSON.parse(readFileSync(process.argv[i + 1], "utf8")) as { id: string; pass: boolean; note?: string }[];
const byId = new Map(runs.map((r) => [r.id, r]));
let bad = 0;
for (const r of REAL_REQUESTS) {
  const run = byId.get(r.id);
  if (!run) { bad++; console.log(`MISSING ${r.id}`); }
  else if (!run.pass) { bad++; console.log(`REGRESSED ${r.id}: ${r.behaviour} — ${run.note ?? "no note"} (forbidden: ${r.forbidden})`); }
}
console.log(`${REAL_REQUESTS.length - bad}/${REAL_REQUESTS.length} live cases pass`);
process.exit(bad ? 1 : 0);
