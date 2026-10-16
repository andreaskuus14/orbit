import { test } from "node:test";
import assert from "node:assert/strict";
import { anniversary, pickRecall } from "../src/lib/resurface-pure.ts";

const TZ = "Europe/Tallinn";
const t = (iso: string) => Date.parse(iso);
const mem = (id: string, created_at: string, kind = "note") => ({ id, title: `T ${id}`, kind, created_at });

test("anniversaries: week, months, years", () => {
  const now = t("2026-10-16T07:00:00Z");
  assert.equal(anniversary(t("2026-10-09T20:00:00Z"), now, TZ), "1 week ago");
  assert.equal(anniversary(t("2026-09-16T05:00:00Z"), now, TZ), "1 month ago");
  assert.equal(anniversary(t("2026-07-16T05:00:00Z"), now, TZ), "3 months ago");
  assert.equal(anniversary(t("2026-04-16T05:00:00Z"), now, TZ), "6 months ago");
  assert.equal(anniversary(t("2025-10-16T05:00:00Z"), now, TZ), "1 year ago");
  assert.equal(anniversary(t("2023-10-16T05:00:00Z"), now, TZ), "3 years ago");
  assert.equal(anniversary(t("2026-08-16T05:00:00Z"), now, TZ), null); // 2 months: not a milestone
  assert.equal(anniversary(t("2026-09-15T05:00:00Z"), now, TZ), null);
});

test("month ends clamp: Jan 31 → Feb 28 / Feb 29 in leap years; Feb 29 → Feb 28 a year later", () => {
  assert.equal(anniversary(t("2027-01-31T10:00:00Z"), t("2027-02-28T10:00:00Z"), TZ), "1 month ago");
  assert.equal(anniversary(t("2028-01-31T10:00:00Z"), t("2028-02-29T10:00:00Z"), TZ), "1 month ago");
  assert.equal(anniversary(t("2028-01-31T10:00:00Z"), t("2028-02-28T10:00:00Z"), TZ), null); // leap year: wait for the 29th
  assert.equal(anniversary(t("2028-02-29T10:00:00Z"), t("2029-02-28T10:00:00Z"), TZ), "1 year ago");
  assert.equal(anniversary(t("2026-08-31T10:00:00Z"), t("2027-02-28T10:00:00Z"), TZ), "6 months ago");
  assert.equal(anniversary(t("2026-11-30T10:00:00Z"), t("2027-02-28T10:00:00Z"), TZ), "3 months ago"); // across a year end
});

test("local calendar days follow the timezone", () => {
  const then = t("2026-09-15T22:30:00Z"); // Sep 16 01:30 in Tallinn, still Sep 15 in UTC
  const now = t("2026-10-16T07:00:00Z");
  assert.equal(anniversary(then, now, TZ), "1 month ago");
  assert.equal(anniversary(then, now, "UTC"), null);
});

test("pickRecall: anniversaries first, preferred kinds, no conversations", () => {
  const now = t("2026-10-16T07:00:00Z");
  const r = pickRecall([
    mem("conv", "2025-10-16T05:00:00Z", "conversation"),
    mem("note", "2026-09-16T05:00:00Z"),
    mem("goal", "2026-07-16T05:00:00Z", "goal"),
    mem("old", "2024-03-03T05:00:00Z", "idea"),
  ], now, TZ);
  assert.deepEqual(r, [{ id: "goal", title: "T goal", label: "3 months ago" }, { id: "note", title: "T note", label: "1 month ago" }]);
});

test("pickRecall fallback: older than 30 days, stable within a day, changes across days", () => {
  const now = t("2026-10-16T07:00:00Z");
  const mems = Array.from({ length: 40 }, (_, i) => mem(`m${i}`, new Date(t("2025-01-03T05:00:00Z") + i * 3 * 86_400_000).toISOString()));
  mems.push(mem("young", "2026-10-01T05:00:00Z"));
  const a = pickRecall(mems, now, TZ), b = pickRecall([...mems].reverse(), now + 3_600_000, TZ);
  assert.equal(a.length, 2);
  assert.deepEqual(a, b);
  assert.ok(!a.some((x) => x.id === "young"));
  assert.match(a[0].label, /ago$/);
  const days = new Set(Array.from({ length: 5 }, (_, d) => pickRecall(mems, now + d * 86_400_000, TZ)[0].id));
  assert.ok(days.size > 1);
  assert.deepEqual(pickRecall([mem("x", "2026-10-10T05:00:00Z")], now, TZ), []);
});
