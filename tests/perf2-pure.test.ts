import { test } from "node:test";
import assert from "node:assert/strict";
import { THUMB_W, resizable, thumbWidth } from "../src/lib/intel-rich-pure.ts";
import { createTtlCache } from "../src/lib/ttl-cache-pure.ts";

test("news pictures are asked at the card's size", () => {
  assert.equal(thumbWidth("sm"), THUMB_W.sm);
  assert.equal(thumbWidth("lead"), THUMB_W.lead);
  assert.equal(thumbWidth(null), THUMB_W.lead);
  assert.ok(THUMB_W.sm >= 152, "small card is 76 css px: sharp at 2x");
});

test("only safe raster types are re-encoded", () => {
  for (const t of ["image/jpeg", "image/png", "image/webp", "image/avif"]) assert.ok(resizable(t));
  for (const t of ["image/gif", "image/x-icon", "image/svg+xml", "text/html"]) assert.ok(!resizable(t));
});

test("shared status reads: several pollers inside the fresh window make one request, a failure is not kept", async () => {
  let now = 0, calls = 0;
  const c = createTtlCache<unknown>({ max: 16, ttlMs: 20_000, now: () => now });
  const get = (v: unknown) => c.memo("/api/needs-you?lang=en", async () => { calls++; return v; }, (x) => x !== null);
  await Promise.all([get({ items: [] }), get({ items: [] })]); // galaxy + planet at the same moment
  now = 15_000; await get({ items: [] });                       // home desk 15 s later
  assert.equal(calls, 1);
  now = 21_000; await get(null);                                // window over, server down
  now = 22_000; await get({ items: [1] });
  assert.equal(calls, 3);
});
