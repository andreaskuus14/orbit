import { test } from "node:test";
import assert from "node:assert/strict";
import { CORE_CLEAR, MAX_COMETS, ORBIT_GAP, cometItems, cometPosition, cometRadius, daysLeft, isUrgent } from "../src/lib/comet-pure.ts";
import { PLANETS } from "../src/lib/planets.ts";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const ok = (text: string, due: string, kind = "chat") => ({ text, owner: "me", status: "confirmed", due, at: "2026-11-12T08:00:00Z", source: { kind } });

test("radius grows with days left and never sits on a planet orbit", () => {
  assert.equal(cometRadius(0), CORE_CLEAR);
  let prev = 0;
  for (let d = 0; d <= 45; d += 0.25) {
    const r = cometRadius(d);
    assert.ok(r >= prev, `monotonic at ${d}`); prev = r;
    for (const p of PLANETS) assert.ok(Math.abs(r - p.radius) >= ORBIT_GAP - 1e-9, `day ${d} r ${r} hits ${p.id}`);
  }
  assert.equal(cometRadius(1000), cometRadius(45));
  assert.equal(cometRadius(NaN), cometRadius(45));
});

test("closer as the deadline nears; red inside 48 h", () => {
  const it = { id: "x", due: "2026-11-20" };
  const dist = (t: number) => Math.hypot(cometPosition(it, t)[0], cometPosition(it, t)[2]);
  assert.ok(dist(NOW + 3 * 86_400_000) < dist(NOW));
  assert.ok(daysLeft("2026-11-12", NOW) < 1);
  assert.equal(isUrgent("2026-11-13", NOW), true);
  assert.equal(isUrgent("2026-11-20", NOW), false);
});

test("only allowlisted commitments; LIFE/journal and unconfirmed never become comets", () => {
  const out = cometItems({ commitments: [ok("Send portfolio", "2026-11-14"), ok("Journal secret", "2026-11-14", "journal"), ok("Life thing", "2026-11-14", "life"),
    { ...ok("Maybe", "2026-11-14"), status: "awaiting" }, ok("No date", "")] }, NOW);
  assert.deepEqual(out.map((c) => c.title), ["Send portfolio"]);
});

test("invoices by number only, decisions by revisit tag, past and far ones dropped, capped", () => {
  const out = cometItems({
    invoices: [{ id: "a", number: "2026-007", status: "sent", due: "2026-11-15" }, { id: "b", number: "8", status: "paid", due: "2026-11-15" }, { id: "c", number: "9", status: "sent", due: "2026-11-01" }],
    decisions: [{ id: "d1", kind: "decision", title: "Decision: Use Blender", tags: ["decision", "revisit:2026-12-01"] }, { id: "d2", kind: "decision", title: "Closed", tags: ["revisit:2026-12-01", "revisited"] },
      { id: "d3", kind: "decision", title: "Far", tags: ["revisit:2027-06-01"] }],
  }, NOW);
  assert.deepEqual(out.map((c) => [c.title, c.panel]), [["Invoice 2026-007", "business"], ["Revisit: Use Blender", "memory"]]);
  const many = cometItems({ invoices: Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, number: `${i}`, status: "sent", due: "2026-11-20" })) }, NOW);
  assert.equal(many.length, MAX_COMETS);
});
