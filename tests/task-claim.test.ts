import { test } from "node:test";
import assert from "node:assert/strict";
import { claimable, claimFilter, LEASE_MS, missingOwnerColumn, type ClaimRow } from "../src/lib/task-claim-pure.ts";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test("claimable: queued is free, owned running is not, expired lease is reclaimable", () => {
  assert.equal(claimable({ status: "queued" }, "A", NOW), true);
  assert.equal(claimable({ status: "running", claimed_by: null, started_at: ago(1000) }, "A", NOW), true); // inserted as running
  assert.equal(claimable({ status: "running", claimed_by: "B", started_at: ago(1000) }, "A", NOW), false);
  assert.equal(claimable({ status: "running", claimed_by: "A", started_at: ago(1000) }, "A", NOW), false); // only via handoff
  assert.equal(claimable({ status: "running", claimed_by: "B", started_at: ago(LEASE_MS - 1000) }, "A", NOW), false);
  assert.equal(claimable({ status: "running", claimed_by: "B", started_at: ago(LEASE_MS + 1000) }, "A", NOW), true);
  for (const status of ["cancelled", "done", "failed", "awaiting_approval"]) assert.equal(claimable({ status }, "A", NOW), false);
});

test("claimable handoff: only our own running claim", () => {
  assert.equal(claimable({ status: "running", claimed_by: "A" }, "A", NOW, true), true);
  assert.equal(claimable({ status: "running", claimed_by: "B" }, "A", NOW, true), false);
  assert.equal(claimable({ status: "cancelled", claimed_by: "A" }, "A", NOW, true), false);
});

test("claimFilter carries the same three clauses with the lease cutoff", () => {
  assert.equal(claimFilter(NOW),
    `status.eq.queued,and(status.eq.running,claimed_by.is.null),and(status.eq.running,started_at.lt."${ago(LEASE_MS)}")`);
});

test("missingOwnerColumn spots an unapplied migration only", () => {
  assert.equal(missingOwnerColumn({ code: "42703", message: 'column tasks.claimed_by does not exist' }), true);
  assert.equal(missingOwnerColumn({ code: "PGRST204", message: "Could not find the 'claimed_by' column" }), true);
  assert.equal(missingOwnerColumn({ code: "57014", message: "timeout" }), false);
  assert.equal(missingOwnerColumn(null), false);
});

// Fake store: the conditional update is atomic (as one Postgres UPDATE ... WHERE ... RETURNING is); reads are not.
function fakeStore(row: ClaimRow) {
  return {
    row,
    async read() { await new Promise((r) => setImmediate(r)); return { ...row }; },
    async claim(worker: string, handoff = false) {
      await new Promise((r) => setImmediate(r));
      if (!claimable(row, worker, NOW, handoff)) return [];
      Object.assign(row, { status: "running", claimed_by: worker, started_at: new Date(NOW).toISOString() });
      return [{ id: "t1" }];
    },
  };
}

async function worker(store: ReturnType<typeof fakeStore>, id: string, ran: string[]) {
  const seen = await store.read(); // both workers see "queued"
  if (seen.status !== "queued") return;
  if (!(await store.claim(id)).length) return; // kickQueue: zero rows = someone else owns it
  if (!(await store.claim(id, true)).length) return; // runTaskInner: refuses unless still ours
  ran.push(id);
}

test("two workers claiming the same queued task concurrently: exactly one executes", async () => {
  for (let i = 0; i < 50; i++) {
    const store = fakeStore({ status: "queued" });
    const ran: string[] = [];
    await Promise.all([worker(store, "A", ran), worker(store, "B", ran)]);
    assert.equal(ran.length, 1);
    assert.equal(store.row.claimed_by, ran[0]);
  }
});

test("a direct runTask racing kickQueue on the same row: one wins", async () => {
  const store = fakeStore({ status: "queued" });
  const [kick, direct] = await Promise.all([store.claim("A"), store.claim("B")]);
  assert.equal(kick.length + direct.length, 1);
});

test("a dead worker's task is reclaimed only after its lease expires", async () => {
  const live = fakeStore({ status: "running", claimed_by: "dead", started_at: ago(5 * 60_000) });
  assert.equal((await live.claim("A")).length, 0);
  const stale = fakeStore({ status: "running", claimed_by: "dead", started_at: ago(LEASE_MS + 60_000) });
  const [a, b] = await Promise.all([stale.claim("A"), stale.claim("B")]);
  assert.equal(a.length + b.length, 1); // the first reclaim renews the lease, so the second fails
});
