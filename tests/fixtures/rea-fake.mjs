// Test double for the public CLI boundary; never presented as a real REA result.
import { readFile } from "node:fs/promises";
import path from "node:path";
const [, , command, source, ...flags] = process.argv;
if (command !== "analyze-javascript-application" || flags.join(" ") !== "--artifact-format directory --json --full-output") throw new Error("Unexpected REA CLI arguments");
if (process.env.ORBIT_REA_TEST_SECRET) throw new Error("ORBIT secret leaked into REA environment");
const content = await readFile(path.join(source, "fixture.ts"), "utf8");
if (content.includes("FAIL")) { console.log(JSON.stringify({ ok: false, error: { message: "fixture failure" } })); process.exitCode = 1; }
else if (content.includes("INVALID")) console.log('{"ok":true,"data":{}}');
else if (content.includes("FLOOD")) { for (let i = 0; i < 5000; i++) process.stdout.write("x".repeat(1000)); }
else if (content.includes("WAIT")) { process.stderr.write('{"rea_progress":{"message":"fixture waiting"}}\n'); setInterval(() => {}, 1000); }
else {
  const evidence = { evidence_id: `ev_${"a".repeat(64)}`, operation: "analyze_javascript_application", confidence: "observed", authority: "shipped-artifact", provider: { id: "fixture", name: "Test double", version: "0" }, limitations: ["Fixture only"], normalized_result: { statistics: { modules: 1 }, limitations: [], graph: { graph_id: "jag_fixture", nodes: [{ kind: "javascript-module", node_id: "node-fixture", observations: [{ label: "fixture.ts", properties: { text: content } }] }], edges: [] } } };
  console.log(JSON.stringify({ ok: true, data: evidence, meta: { command } }));
}
