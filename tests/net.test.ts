import { test } from "node:test";
import assert from "node:assert/strict";
import { pickPublicAddress, assertHttpUrl, redirectTarget, readCapped, createLimiter } from "../src/lib/pure.ts";

test("pickPublicAddress refuses empty answers and any private address", () => {
  assert.equal(pickPublicAddress([{ address: "93.184.216.34", family: 4 }]).address, "93.184.216.34");
  assert.throws(() => pickPublicAddress([]));
  assert.throws(() => pickPublicAddress([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }]));
  assert.throws(() => pickPublicAddress([{ address: "::1", family: 6 }]));
  assert.throws(() => pickPublicAddress([{ address: "::ffff:127.0.0.1", family: 6 }]));
});

test("redirectTarget resolves relative hops and rejects non-http targets", () => {
  const base = new URL("https://a.example/x/y");
  assert.equal(redirectTarget(200, "/z", base), null);
  assert.equal(redirectTarget(302, null, base), null);
  assert.equal(redirectTarget(301, "/z", base)?.toString(), "https://a.example/z");
  assert.equal(redirectTarget(307, "http://b.example/", base)?.hostname, "b.example");
  assert.throws(() => redirectTarget(302, "file:///etc/passwd", base));
  assert.throws(() => redirectTarget(302, "gopher://x/", base));
  assert.throws(() => assertHttpUrl(new URL("ftp://x/")));
});

async function* chunks(sizes: number[], seen: { n: number }) {
  try { for (const s of sizes) { seen.n++; yield new Uint8Array(s).fill(7); } }
  finally { seen.n = -seen.n; } // marks that the source was closed
}

test("readCapped stops reading once the cap is hit and closes the source", async () => {
  const seen = { n: 0 };
  const r = await readCapped(chunks([4, 4, 4, 4], seen), 6);
  assert.equal(r.bytes.length, 6);
  assert.equal(r.truncated, true);
  assert.equal(seen.n, -2); // read only two chunks, then closed
  const all = await readCapped(chunks([3, 2], { n: 0 }), 100);
  assert.deepEqual([all.bytes.length, all.truncated], [5, false]);
});

test("createLimiter never exceeds its limit and runs queued work in order", async () => {
  const run = createLimiter(2);
  let active = 0, peak = 0;
  const order: number[] = [];
  const job = (i: number) => run(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    order.push(i); active--;
    if (i === 1) throw new Error("boom"); // failures free the slot too
    return i;
  });
  const results = await Promise.allSettled([0, 1, 2, 3, 4].map(job));
  assert.equal(peak, 2);
  assert.deepEqual(order.slice(2).sort(), [2, 3, 4]);
  assert.equal(results[1].status, "rejected");
  assert.equal(await run(async () => "free"), "free");
});

test("createLimiter: aborting while queued gives up the place", async () => {
  const run = createLimiter(1);
  let release!: () => void;
  const first = run(() => new Promise<void>((r) => { release = r; }));
  const ac = new AbortController();
  const queued = run(async () => "ran", ac.signal);
  ac.abort();
  await assert.rejects(queued);
  release();
  await first;
  assert.equal(await run(async () => "next"), "next");
});
