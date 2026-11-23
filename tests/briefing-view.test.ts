import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBriefing, runLine, storyKey, storyTrust, stripMarks, type Cite } from "../src/lib/briefing-view-pure.ts";
import { applyBriefing, briefingClaims, briefingNote, type Verdict } from "../src/lib/factcheck-pure.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = (n: number) => `[a:${id(n)}]`;
const RAW = `## World & conflict
### Ceasefire talks resume in Cairo — Confirmed
Negotiators returned to Cairo on Saturday ${A(1)} ${A(2)}. US mediators joined ${A(2)}.
### Ukraine says drones hit a depot — Single source
Ukraine's army said its drones struck a fuel depot overnight ${A(3)}. Russia has not commented ${A(3)}.
## For you
### Roblox opens a creator fund — Single source
Roblox will open a 20 million dollar fund ${A(4)}. The fund will also pay for marketing help ${A(4)}.
## Suggested next steps
1. Check the fund rules ${A(4)}.`;
const SRC = new Map([
  [id(1), { id: id(1), text: "Negotiators returned to Cairo on Saturday for talks.", outlet: "BBC World", topic: "world" }],
  [id(2), { id: id(2), text: "US mediators joined the Cairo talks.", outlet: "Al Jazeera", topic: "world" }],
  [id(3), { id: id(3), text: "Ukraine's army said its drones struck a fuel depot.", outlet: "The Guardian", topic: "world" }],
  [id(4), { id: id(4), text: "Roblox will open a fund of 20 million dollars.", outlet: "The Verge", topic: "Roblox" }],
]);
function checked() {
  const claims = briefingClaims(RAW), v = new Map<number, Verdict>();
  for (const c of claims) v.set(c.key, /marketing/.test(c.sentence) ? "not_backed" : /not commented/.test(c.sentence) ? "contradicted" : "backed");
  const r = applyBriefing(RAW, claims, v, SRC);
  return `${r.content}\n\n${briefingNote(r)}`;
}
const cites: Cite[] = [1, 2, 3, 4].map((n) => ({ id: id(n), url: `https://example.com/${n}`, title: `T${n}`, source: SRC.get(id(n))!.outlet, published_at: null }));

test("the fact check's marks leave the text and become flags", () => {
  const content = checked();
  assert.match(content, /\(not backed by the source\)/, "fixture: the real fact check marked the text");
  const p = parseBriefing(content);
  const all = p.sections.flatMap((s) => s.stories);
  assert.ok(all.every((s) => s.lines.every((l) => !/not backed|only one source|Fact check/.test(l))), "no inline marks or note left");
  const roblox = all.find((s) => s.title?.startsWith("Roblox"))!;
  assert.deepEqual(roblox.flags.map((f) => f.kind), ["not_backed"]);
  assert.equal(roblox.flags[0].sentence, "The fund will also pay for marketing help.");
  assert.equal(p.removed, 1, "the removed count from the note is kept");
  const ukraine = all.find((s) => s.title?.startsWith("Ukraine"))!;
  assert.equal(ukraine.flags.find((f) => f.kind === "one_source")?.sentence, "Ukraine's army said its drones struck a fuel depot overnight.");
});

test("For you comes first, next steps last; labels come off the titles", () => {
  const p = parseBriefing(checked());
  assert.deepEqual(p.sections.map((s) => s.kind), ["for_you", "world", "next"]);
  const cairo = p.sections[1].stories[0];
  assert.equal(cairo.title, "Ceasefire talks resume in Cairo");
  assert.equal(cairo.label, "confirmed");
  assert.deepEqual(cairo.cites, [id(1), id(2)]);
  assert.equal(p.sections[2].stories[0].title, null, "a list block without a ### heading is one untitled story");
});

test("trust: two outlets confirm, one is single, a failed sentence asks for a check", () => {
  const p = parseBriefing(checked()), all = p.sections.flatMap((s) => s.stories);
  const by = (t: string) => storyTrust(all.find((s) => s.title?.startsWith(t))!, cites);
  assert.equal(by("Ceasefire").level, "confirmed");
  assert.equal(by("Ceasefire").outlets, 2);
  assert.equal(by("Ukraine").level, "single", "one-source note alone is not a failure");
  assert.equal(by("Roblox").level, "check");
});

test("trust: numbers missing from the cited passages are flagged (INT03), without double flags", () => {
  const ev: Cite[] = [{ id: id(4), url: "https://example.com/4", title: "T4", source: "The Verge", published_at: null, evidence: "fetched", passage: "Roblox will open a fund." }];
  const p = parseBriefing(`### Fund\nRoblox will open a 20 million dollar fund ${A(4)}.`);
  const t = storyTrust(p.sections[0].stories[0], ev);
  assert.equal(t.level, "check");
  assert.deepEqual(t.flags.map((f) => [f.kind, f.detail]), [["number", "20"]]);
  assert.equal(t.read, 1);
});

test("old briefings without marks or labels parse as plain stories", () => {
  const p = parseBriefing(`Intro line ${A(1)}.\n- Point one ${A(2)}.\n- Point two.`);
  assert.equal(p.sections.length, 1);
  assert.equal(p.sections[0].stories[0].lines.length, 3);
  assert.equal(p.sections[0].stories[0].label, null);
});

test("Estonian marks strip too", () => {
  const r = stripMarks(`See on nii (allikas seda ei kinnita) ${A(1)}. Teine (ainult üks allikas) ${A(2)}.`);
  assert.deepEqual(r.flags.map((f) => f.kind), ["not_backed", "one_source"]);
  assert.doesNotMatch(r.text, /allikas/);
});

test("runLine never shows a finished run's counters; a failed run shows its error", () => {
  const ok = runLine({ status: "ok", detail: "manual: 10 articles, fact check 9 backed (6807 ms)", started_at: "2026-11-22T20:00:00Z" })!;
  assert.deepEqual(ok, { state: "done", at: "2026-11-22T20:00:00Z" });
  assert.equal(runLine({ status: "failed", detail: "morning: Feeds unreachable", started_at: "x" })!.error, "Feeds unreachable");
  assert.equal(runLine({ status: "running", detail: "manual: world", started_at: "x" })!.state, "running");
  assert.equal(runLine(undefined), null);
});

test("storyKey is stable per briefing and title", () => {
  assert.equal(storyKey("b1", "Roblox opens a fund!"), storyKey("b1", "roblox  opens a fund"));
  assert.notEqual(storyKey("b1", "x"), storyKey("b2", "x"));
});
