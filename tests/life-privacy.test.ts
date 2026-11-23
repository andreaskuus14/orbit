import { test } from "node:test";
import assert from "node:assert/strict";
import { liteLife, parseDraft, screenshotAllowed, shieldActive, shieldUntil, SHIELD_TTL_MS, DRAFT_KEY } from "../src/lib/life-private-pure.ts";
import { view, emptyStore } from "../src/lib/life-pure.ts";

const SECRET = "my very private diary line";
const full = () => {
  const now = Date.parse("2026-11-20T12:00:00");
  const s = { ...emptyStore(), journal: { "2026-11-20": SECRET, "2026-11-19": SECRET } };
  return { ...view(s, now), notes: [{ id: "n1", date: "2026-11-19", source: "evening", text: SECRET }] };
};

test("counts endpoint can't return journal fields or text", () => {
  const lite = liteLife(full(), 2);
  assert.ok(!("journal" in lite) && !("notes" in lite));
  assert.ok(!JSON.stringify(lite).includes(SECRET));
  assert.deepEqual(Object.keys(lite).sort(), ["focus", "habits", "journalDays", "reminders", "review", "timer", "today", "work"]);
  assert.equal(lite.journalDays, 2);
  // extra fields on the input never pass through
  const sneaky = { ...full(), diary: SECRET } as unknown as Parameters<typeof liteLife>[0];
  assert.ok(!JSON.stringify(liteLife(sneaky, -1)).includes(SECRET));
  assert.equal(liteLife(sneaky, -1).journalDays, 0);
});

test("shield expires on its own and blocks screenshots while on", () => {
  const now = 1_000_000;
  const u = shieldUntil(now);
  assert.ok(shieldActive(u, now + SHIELD_TTL_MS - 1));
  assert.ok(!shieldActive(u, now + SHIELD_TTL_MS));
  assert.ok(!shieldActive(null, now));
  assert.equal(screenshotAllowed(false, u, now), false);
  assert.equal(screenshotAllowed(true, null, now), false);
  assert.equal(screenshotAllowed(false, null, now), true);
  assert.equal(screenshotAllowed(false, u, now + SHIELD_TTL_MS + 1), true);
});

test("journal draft comes back only for its own day", () => {
  assert.equal(DRAFT_KEY, "orbit.life.journalDraft");
  const raw = JSON.stringify({ date: "2026-11-20", text: "kept" });
  assert.equal(parseDraft(raw, "2026-11-20"), "kept");
  assert.equal(parseDraft(raw, "2026-11-21"), null);
  assert.equal(parseDraft("not json", "2026-11-20"), null);
  assert.equal(parseDraft(null, "2026-11-20"), null);
});
