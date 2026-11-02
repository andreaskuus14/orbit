import { test } from "node:test";
import assert from "node:assert/strict";
import { fromPush, ntfyAllowed, ntfyConfig, publishBody, taskMsg } from "../src/lib/ntfy-pure.ts";
import { DEFAULT_QUIET, gate, parseQuiet, pushLabel, quietAt } from "../src/lib/remote-push-pure.ts";

const topic = "orbit-3f9a1c2b7d4e5f60";
const at = (h: number) => Date.parse(`2026-07-01T${String((h - 3 + 24) % 24).padStart(2, "0")}:30:00Z`); // Tallinn = UTC+3 in July

test("ntfyConfig: off without a topic, refuses short or odd topics, defaults to ntfy.sh", () => {
  assert.equal(ntfyConfig({}, DEFAULT_QUIET), null);
  assert.ok("problem" in (ntfyConfig({ ORBIT_NTFY_TOPIC: "orbit" }, DEFAULT_QUIET) as object));
  assert.ok("problem" in (ntfyConfig({ ORBIT_NTFY_TOPIC: "has spaces in it ok?" }, DEFAULT_QUIET) as object));
  assert.ok("problem" in (ntfyConfig({ ORBIT_NTFY_TOPIC: topic, ORBIT_NTFY_URL: "ftp://x" }, DEFAULT_QUIET) as object));
  assert.deepEqual(ntfyConfig({ ORBIT_NTFY_TOPIC: topic }, DEFAULT_QUIET), { server: "https://ntfy.sh", topic, open: "", quiet: DEFAULT_QUIET });
  const c = ntfyConfig({ ORBIT_NTFY_TOPIC: topic, ORBIT_NTFY_URL: "https://ntfy.example.com/", ORBIT_NTFY_OPEN_URL: "https://pc.tail1.ts.net:3000/" }, null);
  assert.deepEqual(c, { server: "https://ntfy.example.com", topic, open: "https://pc.tail1.ts.net:3000", quiet: null });
});

test("quiet hours: parse, wrap past midnight, off; failures and Stop-all notices still go", () => {
  assert.deepEqual(parseQuiet(""), [23, 8]);
  assert.deepEqual(parseQuiet("22:00-07:30"), [22, 7]);
  assert.equal(parseQuiet("off"), null);
  assert.deepEqual(parseQuiet("nonsense"), [23, 8]);
  assert.equal(quietAt(at(23)), true);
  assert.equal(quietAt(at(7)), true);
  assert.equal(quietAt(at(12)), false);
  assert.equal(quietAt(at(13), [13, 15]), true);
  assert.equal(quietAt(at(2), null), false);
  assert.equal(gate(undefined, "clip", at(2), null).send, 1); // the setting reaches Web Push too
  assert.equal(ntfyAllowed("done", at(2), DEFAULT_QUIET, false), false);
  assert.equal(ntfyAllowed("failed", at(2), DEFAULT_QUIET, false), true);
  assert.equal(ntfyAllowed("done", at(12), DEFAULT_QUIET, false), true);
  assert.equal(ntfyAllowed("failed", at(12), DEFAULT_QUIET, true), false); // Stop-all: nothing
  assert.equal(ntfyAllowed("stop", at(12), DEFAULT_QUIET, true), true);
});

test("messages carry fixed labels, counts and receipt status only; Open goes to ORBIT over Tailscale", () => {
  const done = taskMsg("done", "verified", "https://pc.ts.net");
  assert.equal(done?.title, "Task finished · verified");
  assert.equal(done?.click, "https://pc.ts.net/remote#r-queue");
  assert.equal(taskMsg("failed", null, "")?.click, undefined);
  assert.equal(taskMsg("awaiting_approval", null, "")?.kind, "decide");
  assert.equal(taskMsg("running", null, ""), null);
  const m = fromPush(pushLabel("clip", 22), "https://pc.ts.net");
  assert.equal(m.title, "22 new clips to review");
  assert.equal(m.click, "https://pc.ts.net/remote#r-appr");
  const c = ntfyConfig({ ORBIT_NTFY_TOPIC: topic }, null)!;
  assert.ok(!("problem" in c));
  const body = publishBody(c as Exclude<typeof c, { problem: string }>, m);
  assert.equal(body.topic, topic);
  assert.deepEqual(body.actions, [{ action: "view", label: "Open", url: "https://pc.ts.net/remote#r-appr" }]);
  assert.equal("actions" in publishBody(c as Exclude<typeof c, { problem: string }>, taskMsg("failed", null, "")!), false);
});
