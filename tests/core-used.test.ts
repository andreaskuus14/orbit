import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentNames, buildUsed, usedLine, USED_CAP } from "../src/lib/core-used-pure.ts";
import { translate } from "../src/lib/i18n-pure.ts";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const en = (k: string, v?: Record<string, string | number>) => translate("en", k as never, v);
const et = (k: string, v?: Record<string, string | number>) => translate("et", k as never, v);

test("a fixture turn: 2 memories + 1 private journal note -> 2 titles and 'a private note', no private text anywhere", () => {
  const u = buildUsed({
    now: NOW,
    citations: [{ id: "a", title: "pet sim economy", kind: "note", at: "2026-11-08T12:00:00Z" }, { id: "b", title: "Dream about my ex", kind: "journal", at: "2026-11-01T00:00:00Z" }],
    trace: [{ step: "life_journal", ok: true }, { step: "search_memory", ok: true }, { step: "think", ok: true }],
    privateTools: ["life_journal"],
    extras: { memories: [{ id: "c", title: "plan notes", kind: "note", created_at: "2026-11-20T08:00:00Z" }] },
  });
  const line = usedLine(u, en, true);
  assert.match(line, /memory: 'pet sim economy' · 12 d/);
  assert.match(line, /memory: 'plan notes' · today/);
  assert.match(line, /2 private notes/); // the journal memory and the private module read
  assert.ok(!/ex\b|Dream|life_journal|journal/i.test(line), line);
  assert.ok(!JSON.stringify(u).match(/Dream|ex\b|life_journal/), "no private title or tool name in the data either");
});

test("dedupes memories by id, cited first, and web/tool steps are counted and skip failed or bookkeeping steps", () => {
  const u = buildUsed({
    now: NOW,
    citations: [{ id: "a", title: "T", kind: "note" }],
    trace: [{ step: "fetch_url", ok: true }, { step: "fetch_url", ok: true }, { step: "fetch_url", ok: false }, { step: "web_search", ok: true }, { step: "ws_write", ok: true }, { step: "ws_write", ok: true }, { step: "fallback", ok: false }, { step: "answer_eval" }],
    extras: { memories: [{ id: "a", title: "T", kind: "note" }, { id: "z", title: "Z", kind: "note", updated_at: "2026-11-19T12:00:00Z" }], context: ["world"] },
  });
  assert.deepEqual(u.items.map((i) => i.kind + ":" + (i.title ?? "")), ["memory:T", "memory:Z", "fact:world", "tool:ws_write", "web:pages", "web:searches"]);
  const line = usedLine(u, en, true);
  assert.match(line, /web: 2 pages/);
  assert.match(line, /web: 1 searches|web: 1 search/);
  assert.match(line, /tool: ws write ×2/);
  assert.match(line, /context: goals and week/);
});

test("caps at 6 items with '+N more'; the full view lists everything", () => {
  const memories = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, title: `Memory ${i}`, kind: "note", created_at: "2026-11-10T00:00:00Z" }));
  const u = buildUsed({ now: NOW, extras: { memories } });
  assert.equal(u.shown.length, USED_CAP);
  assert.equal(u.more, 3);
  assert.match(usedLine(u, en), /\+3 more$/);
  assert.ok(!usedLine(u, en).includes("Memory 8"));
  assert.ok(usedLine(u, en, true).includes("Memory 8") && !usedLine(u, en, true).includes("more"));
});

test("files come from the attachment block as names only; week-review sources show as the module, LIFE kinds are private; empty -> ''", () => {
  const block = `ATTACHED FILES (...):\n<attachment name="plan.pdf">\nsecret body text\n</attachment>\nImages attached to this message (you can see them): "shot.png".\n\n`;
  assert.deepEqual(attachmentNames(block), ["plan.pdf", "shot.png"]);
  const u = buildUsed({ now: NOW, citations: [{ id: "w1", title: "Week of 10 Nov: private budget", kind: "week:goal" }, { id: "l1", title: "life plan secret", kind: "life-plan" }], extras: { files: attachmentNames(block) } });
  const line = usedLine(u, en, true);
  assert.match(line, /file: plan\.pdf/);
  assert.match(line, /a private note/);
  assert.ok(!/budget|secret|body text/.test(line), line);
  assert.equal(usedLine(buildUsed({ now: NOW }), en), "");
});

test("Estonian labels exist and long titles are clipped", () => {
  const u = buildUsed({ now: NOW, citations: [{ id: "a", title: "x".repeat(200), kind: "note", at: "2026-11-18T12:00:00Z" }], extras: { context: ["people"] } });
  assert.ok(u.items[0].title!.length <= 48);
  const line = usedLine(u, et, true);
  assert.match(line, /mälestus: 'x+…' · 2 p/);
  assert.match(line, /kontekst: inimesed/);
});
