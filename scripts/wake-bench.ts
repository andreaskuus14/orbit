// False-accept rate of the wake-word matcher on 10,000 sentences (Tatoeba, CC-BY 2.0 FR: 2,000 Estonian,
// 300 English with "orbit", the rest random English). Run: node --experimental-strip-types scripts/wake-bench.ts [-v]
import { readFileSync } from "node:fs";
import { extractWakeQuestion } from "../src/components/voice/wake.ts";

const lines = readFileSync(new URL("../tests/fixtures/wake-corpus.txt", import.meta.url), "utf8").split("\n").filter(Boolean);
const hits = lines.filter((l) => extractWakeQuestion(l));
console.log(`false accepts: ${hits.length} / ${lines.length} = ${((100 * hits.length) / lines.length).toFixed(2)}%`);
if (process.argv.includes("-v")) for (const h of hits) console.log("  " + h);
