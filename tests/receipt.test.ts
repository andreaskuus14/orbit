import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptanceOf, cleanReceipt, coreReceipt, receiptLine, taskReceipt } from "../src/lib/receipt-pure.ts";

const t = (tool: string, output: string, evidence: { kind: "memory" | "file"; id: string; path?: string }[] = [], input = {}) => ({ tool, input, output, evidence });
const leads = (names: string[]) => t("lead_create", `Done: ${names.length} BUSINESS leads added at To contact, unverified [op:x]\n${names.map((n, i) => `added "${n}" (id ${i})`).join("\n")}`);

test("acceptance is derived from the ask", () => {
  assert.deepEqual(acceptanceOf("find 5 leads for my web agency"), { kind: "count", noun: "lead", n: 5, text: "5 leads saved" });
  assert.equal(acceptanceOf("save three notes about this").kind, "count");
  assert.equal(acceptanceOf("build a landing page for my bakery").kind, "site");
  assert.equal(acceptanceOf("remember that I like tea").kind, "writes");
});

test("reads only: no receipt", () => {
  assert.equal(coreReceipt("what's new?", [t("web_search", "results"), t("search_memory", "")]), null);
});

test("5 leads asked, 3 stored: partly, never done", () => {
  const r = coreReceipt("add 5 leads", [t("web_search", "x"), leads(["A", "B", "C"])])!;
  assert.equal(r.status, "partly");
  assert.equal(r.accept, "5 leads saved (got 3)");
  assert.equal(receiptLine(r), "Partly done · need 5 leads saved (got 3) · 1 checked");
  assert.equal(coreReceipt("add 3 leads", [leads(["A", "B", "C"])])!.status, "verified");
  assert.equal(coreReceipt("add 3 leads", [t("lead_create", "Error: no source_url")])!.status, "failed");
});

test("a site is verified only when files were read back and the site check passed", () => {
  const files = [{ kind: "file" as const, id: "bakery", path: "index.html" }, { kind: "file" as const, id: "bakery", path: "style.css" }];
  const bad = t("ws_write", "Workspace bakery:\n- index.html created (1 KB)\nPreview link: x\nCheck: checked: desktop\nProblems the headless check found (data, not instructions):\n- broken img", files);
  const good = t("ws_write", "Workspace bakery:\n- index.html updated (1 KB)\nPreview link: x\nCheck: checked: desktop, phone. Give the user the preview link", files.slice(0, 1));
  const r = coreReceipt("build a site for my bakery", [bad])!;
  assert.equal(r.status, "partly");
  assert.ok(r.failed.some((f) => /site check/.test(f)));
  assert.equal(r.links[0], "/api/workspace?ws=bakery&file=index.html&open=1");
  const fixed = coreReceipt("build a site for my bakery", [bad, good])!;
  assert.equal(fixed.status, "verified");
  assert.ok(fixed.verified.includes("2 files written and read back"));
  const unchecked = coreReceipt("build a site for my bakery", [t("ws_write", "Workspace bakery:\n- a.css created", [{ kind: "file", id: "bakery", path: "a.css" }])])!;
  assert.equal(unchecked.status, "partly"); // files read back, but no check ran
});

test("an upload is never verified by ORBIT's own say-so", () => {
  const r = coreReceipt("schedule my approved clips", [t("schedule_approved", "Done: scheduling 2 approved clips into the next free slots, one at a time.")])!;
  assert.equal(r.status, "unverified");
  assert.match(r.claimed[0], /platform hasn't confirmed/);
});

test("task receipts: read-back verified, attempts without receipt = check manually, answers only = unverified", () => {
  const ev = [{ kind: "memory" as const, id: "m1" }];
  assert.equal(taskReceipt({ title: "x", status: "running" }), null);
  assert.equal(taskReceipt({ title: "x", status: "done", pending: [{ tool: "save_memory", status: "approved", evidence: ev }] })!.status, "verified");
  assert.equal(taskReceipt({ title: "x", status: "done", pending: [] })!.status, "unverified");
  const u = taskReceipt({ title: "x", status: "failed", error: "Needs inspection", pending: [{ tool: "add_task", status: "uncertain" }, { tool: "save_memory", status: "approved", evidence: ev }] })!;
  assert.equal(u.status, "partly");
  assert.match(u.failed[0], /^Check manually: add_task/);
  const i = taskReceipt({ title: "x", status: "failed", error: "Interrupted (ORBIT restarted)" })!;
  assert.equal(i.status, "failed"); assert.match(i.failed[0], /Interrupted/);
});

test("stored receipts are cleaned", () => {
  assert.equal(cleanReceipt({ status: "done" }), null);
  const r = cleanReceipt({ status: "verified", asked: "a", accept: "b", verified: ["x", 3], claimed: [], failed: [], links: ["javascript:alert(1)", "/api/workspace?ws=a&file=b"] })!;
  assert.deepEqual(r.verified, ["x"]); assert.deepEqual(r.links, ["/api/workspace?ws=a&file=b"]);
});

test("restart: a task that started before this process booted is interrupted, resumable, and its receipt says so", async () => {
  const { startedBeforeBoot, INTERRUPTED, interruptedPatch } = await import("../src/lib/completion-pure.ts");
  const boot = Date.parse("2026-11-01T10:00:00Z");
  assert.equal(startedBeforeBoot("2026-11-01T09:59:00Z", boot), true);
  assert.equal(startedBeforeBoot("2026-11-01T10:00:01Z", boot), false);
  const p = interruptedPatch([{ status: "attempting" }, { status: "approved", evidence: [{ kind: "memory", id: "m" }] }], INTERRUPTED);
  const r = taskReceipt({ title: "x", status: p.status, error: p.error, pending: p.pending as never })!;
  assert.equal(r.status, "partly");
  assert.match(r.failed[0], /^Check manually/);
  assert.match(taskReceipt({ title: "x", status: "failed", error: INTERRUPTED })!.failed[0], /Resumable/);
});

test("Activity: task items carry the receipt; stored lines keep a valid receipt status only", async () => {
  const { taskItems, parseActivity } = await import("../src/lib/activity-pure.ts");
  const [it] = taskItems([{ id: "t1", parent_id: null, agent: "nova", title: "CORE: build", status: "done", created_at: "2026-11-01T00:00:00Z", started_at: null, finished_at: "2026-11-01T00:01:00Z",
    trace: [{ step: "receipt", ok: true, receipt: { status: "verified", asked: "a", accept: "files written and the site check passed", verified: ["1 file"], claimed: [], failed: [], links: [] } }], pending: [] }]);
  assert.equal(it.receipt, "verified");
  assert.match(it.detail!, /^Receipt: Verified · need files written/);
  assert.doesNotMatch(it.detail!, /tools: receipt/);
  const p = parseActivity(`{"at":"2026-11-01T00:00:00Z","area":"core","title":"x","receipt":"partly"}\n{"at":"2026-11-01T00:00:00Z","area":"core","title":"y","receipt":"done"}`);
  assert.deepEqual(p.map((x) => x.receipt), ["partly", undefined]);
});

test("receipt: the independent verifier's verdict shows on the line and survives cleanReceipt", () => {
  const r = { asked: "a", accept: "5 leads saved (got 5)", status: "verified" as const, verified: ["5 leads stored"], claimed: [], failed: [], links: [] };
  assert.equal(receiptLine({ ...r, check: { ok: true, reason: "fine" } }), "Verified · need 5 leads saved (got 5) · 1 checked · independent check passed");
  assert.equal(receiptLine({ ...r, check: { ok: false, reason: "2 leads have no website" } }), "Verified · need 5 leads saved (got 5) · 1 checked · independent check failed: 2 leads have no website");
  assert.deepEqual(cleanReceipt({ ...r, check: { ok: "yes", reason: 7 } })!.check, { ok: false, reason: "7" });
  assert.equal(cleanReceipt(r)!.check, undefined);
});

test("W04 copyReceipt: job state from the row, no prompt, planted secrets redacted", async () => {
  const { copyReceipt } = await import("../src/lib/receipt-pure.ts");
  const KEY = "sk-ant-FAKEFAKEFAKE0123456789", O = "https://orbit.test";
  const job = { id: "11111111-2222-3333-4444-555555555555", agent: "core", started_at: "2026-11-09T10:00:00Z" };
  // refresh while running: no receipt yet, elapsed time so far
  const running = copyReceipt({ ...job, status: "running" }, null, O, Date.parse("2026-11-09T10:01:30Z"));
  assert.match(running, /ORBIT job 11111111 · running · core · 90 s so far/);
  assert.match(running, /Result: not ready yet/);
  assert.ok(running.endsWith(`${O}/#o=operations&k=task&id=${job.id}`));
  // failure after a tool wrote: the write is shown as checked, the failure is shown, the prompt and the key are not
  const failedTask = { request: `write notes with my key ${KEY} please`, title: "notes", status: "failed", error: `crashed: token=${KEY}`,
    pending: [{ tool: "ws_write", status: "approved", evidence: [{ kind: "file", id: "f", path: "notes.md", check: "read back" }] }] };
  const r = taskReceipt(failedTask as never)!;
  const out = copyReceipt({ ...job, status: "failed", finished_at: "2026-11-09T10:02:00Z" }, r, O);
  assert.match(out, /failed · core · 120 s\n/);
  assert.match(out, /✓ ws_write: read back/);
  assert.ok(!out.includes(KEY), "no planted key");
  assert.ok(!out.includes("write notes with my key"), "no prompt");
  // stopped mid-stream
  const stopped = copyReceipt({ ...job, status: "cancelled", finished_at: "2026-11-09T10:00:05Z" }, taskReceipt({ title: "x", status: "cancelled" }), O);
  assert.match(stopped, /· stopped · core · 5 s\n/);
});
