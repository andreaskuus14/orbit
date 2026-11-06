import { test } from "node:test";
import assert from "node:assert/strict";
import { nextVersion, wsTainted } from "../src/lib/core-workspace.ts";
import { parseAgentReply } from "../src/lib/pure.ts";
import { partialAnswer } from "../src/lib/streamjson.ts";

test("reading the workspace this task just made from ORBIT's template doesn't block the build", () => {
  const created = 'You called ws_create {"name":"rakvere-betoon","template":"fullstack"}\nRESULT:\nDone: full-stack workspace "rakvere-betoon" with server.mjs';
  const read = (ws: string) => `You called ws_read {"workspace":"${ws}","path":"server.mjs"}\nRESULT:\nFile ${ws}/server.mjs`;
  assert.equal(wsTainted([created, read("rakvere-betoon")], "make me a demo website"), false);
  assert.equal(wsTainted([created, read("Rakvere Betoon")], "make me a demo website"), false);
  assert.equal(wsTainted([read("rakvere-betoon")], "make me a demo website"), true); // not made in this task
  assert.equal(wsTainted([created, read("other-site")], "make me a demo website"), true);
  assert.equal(wsTainted(['You called ws_create {"name":"x"}\nRESULT:\nError: too many', read("x")], "build a site"), true);
});

test("a taken name becomes the next free version", () => {
  assert.equal(nextVersion("rakvere-betoon", ["rakvere-betoon"]), "rakvere-betoon-v2");
  assert.equal(nextVersion("rakvere-betoon", ["rakvere-betoon", "rakvere-betoon-v2"]), "rakvere-betoon-v3");
  assert.equal(nextVersion("rakvere-betoon-v2", ["rakvere-betoon-v2"]), "rakvere-betoon-v3");
  assert.ok(nextVersion("a".repeat(40), []).length <= 40);
});

test("blanked native tool-call markup is never an answer, and never streams", () => {
  const junk = "<invoke_placeholder>\n</invoke_placeholder>\n\n\n<invoke_placeholder>\n</invoke_placeholder>";
  assert.deepEqual(parseAgentReply(junk), { thought: "", garbled: true });
  assert.deepEqual(parseAgentReply("<function_calls>\n</function_calls>"), { thought: "", garbled: true });
  assert.equal(parseAgentReply('<invoke name="ws_list"></invoke>').tool, "ws_list"); // runnable markup still runs
  assert.equal(parseAgentReply("Plain answer about invoices").final, "Plain answer about invoices");
  assert.equal(partialAnswer(junk), null);
});

test("ORBIT's own tools (a saved lesson, statuses, drafts) never block a build; outside text still does", () => {
  const s = (t: string) => `You called ${t} {}\nRESULT:\nx`;
  assert.equal(wsTainted([s("save_memory"), s("goal_status"), s("higgsfield_draft"), s("ws_run")], "rebuild it"), false);
  assert.equal(wsTainted([s("business_status")], "rebuild it"), true); // prospects' replies are other people's text
  assert.equal(wsTainted([s("fetch_url")], "rebuild it"), true);
  assert.equal(wsTainted([s("vault_read")], "build me a site"), true);
  assert.equal(wsTainted([s("ask_agent")], "build me a site"), true);
});

test("picture slots: an odd aspect snaps to the nearest allowed one", async () => {
  const { nearestAspect } = await import("../src/lib/site-pictures-pure.ts");
  assert.equal(nearestAspect(undefined), "16:9");
  assert.equal(nearestAspect("16:9"), "16:9");
  assert.equal(nearestAspect("3:2"), "4:3");
  assert.equal(nearestAspect("21:9"), "16:9");
  assert.equal(nearestAspect("2:3"), "3:4");
  assert.equal(nearestAspect("square"), "1:1");
  assert.equal(nearestAspect("tall"), "9:16");
  assert.equal(nearestAspect("weird"), "16:9");
});
