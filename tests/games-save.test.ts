import { test } from "node:test";
import assert from "node:assert/strict";
import { readStored, planPut, tombstone, createSaveQueue, type SendResult } from "../src/games/saves.ts";
import { parseSave } from "../src/games/planet-forge/rules.ts";

type Game = { coins: number };
const validate = (raw: unknown) =>
  raw && typeof raw === "object" && typeof (raw as Game).coins === "number" ? { ok: true as const } : { ok: false as const, error: "coins is not a number" };

/** In-memory stand-in for the route: same pure rules, one row. */
function fakeServer(initial: unknown = null) {
  let row: unknown = initial;
  return {
    get row() { return row; },
    put(body: Record<string, unknown>): { status: number; json: Record<string, unknown> } {
      const p = planPut(row, body, validate);
      if (!p.ok) return { status: p.status, json: { error: p.error } };
      row = p.save;
      return { status: 200, json: { gen: p.save.gen, rev: p.save.rev } };
    },
    del() { row = tombstone(row); return (row as { gen: number }).gen; },
  };
}
const deferred = () => { let resolve!: () => void; const p = new Promise<void>((r) => { resolve = r; }); return { p, resolve }; };
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Queue wired to the fake server; each send waits for `gate` (if set) before reaching the server. */
function wired(server: ReturnType<typeof fakeServer>) {
  const sent: number[] = [];
  let gate: Promise<void> | null = null;
  const q = createSaveQueue<Game>(async (save, base): Promise<SendResult> => {
    sent.push(save.coins);
    const g = gate; if (g) await g;
    const r = server.put({ save, ...base });
    return r.status === 200 ? { ok: true, rev: r.json.rev as number } : { ok: false, conflict: r.status === 409, error: String(r.json.error) };
  });
  return { q, sent, setGate: (g: Promise<void> | null) => { gate = g; } };
}

test("envelope: legacy rows read as gen 0, damaged data is reported but kept whole", () => {
  assert.deepEqual(readStored(null, validate), { gen: 0, rev: 0, data: null, damaged: null });
  assert.deepEqual(readStored({ coins: 5 }, validate), { gen: 0, rev: 0, data: { coins: 5 }, damaged: null });
  assert.deepEqual(readStored({ v: 1, gen: 2, rev: 7, data: { coins: 1 } }, validate), { gen: 2, rev: 7, data: { coins: 1 }, damaged: null });
  const bad = { v: 1, gen: "x", data: { coins: 1 } };
  const s = readStored(bad, validate);
  assert.equal(s.data, bad);
  assert.match(s.damaged!, /coins/);
  assert.deepEqual(tombstone({ v: 1, gen: 2, rev: 7, data: { coins: 1 } }), { v: 1, gen: 3, rev: 0, data: null });
  assert.equal(tombstone({ garbage: true }).gen, 1);
});

test("planPut: validates, requires gen/rev, rejects stale gen and stale rev", () => {
  const row = { v: 1, gen: 1, rev: 3, data: { coins: 1 } };
  assert.equal((planPut(row, { save: { coins: 2 } }, validate) as { status: number }).status, 400);
  assert.equal((planPut(row, { save: { nope: 1 }, gen: 1, rev: 3 }, validate) as { status: number }).status, 400);
  assert.equal((planPut(row, { save: { coins: 2 }, gen: 0, rev: 3 }, validate) as { status: number }).status, 409);
  assert.equal((planPut(row, { save: { coins: 2 }, gen: 1, rev: 2 }, validate) as { status: number }).status, 409);
  assert.equal((planPut(row, { save: { coins: 2 }, gen: 2, rev: 0 }, validate) as { status: number }).status, 409);
  assert.deepEqual(planPut(row, { save: { coins: 2 }, gen: 1, rev: 3 }, validate), { ok: true, save: { v: 1, gen: 1, rev: 4, data: { coins: 2 } } });
});

test("bug 1: a save in flight during Reset can't resurrect the deleted game", async () => {
  // Server rule alone: the old-gen write arriving after the tombstone is refused.
  const server = fakeServer();
  const old = { save: { coins: 100 }, gen: 0, rev: 0 }; // read before the reset
  server.del();
  assert.equal(server.put(old).status, 409);
  assert.equal((server.row as { data: unknown }).data, null);

  // Client: reset waits for the in-flight save, drops queued ones, and nothing old lands afterwards.
  const s2 = fakeServer();
  const { q, setGate } = wired(s2);
  const g = deferred(); setGate(g.p);
  void q.push({ coins: 100 });
  await tick();
  void q.push({ coins: 120 }); // queued behind it: must be dropped by the reset
  const resetDone = q.reset(async () => s2.del());
  await tick();
  void q.push({ coins: 130 }); // pushed during the reset (old game still in memory): dropped
  setGate(null); g.resolve();
  await resetDone;
  await q.flush();
  assert.deepEqual(s2.row, { v: 1, gen: 1, rev: 0, data: null });
  assert.equal(q.stopped, null);
  await q.push({ coins: 0 }); // the fresh game saves normally in the new generation
  assert.deepEqual(s2.row, { v: 1, gen: 1, rev: 1, data: { coins: 0 } });
});

test("bug 2: saves made while one is in flight aren't dropped; the newest one is sent last", async () => {
  const server = fakeServer();
  const { q, sent, setGate } = wired(server);
  const g = deferred(); setGate(g.p);
  void q.push({ coins: 1 });
  await tick();
  void q.push({ coins: 2 });
  const exitSave = q.push({ coins: 3 }, true); // e.g. Exit while the autosave is still running
  setGate(null); g.resolve();
  await exitSave;
  await q.flush();
  assert.deepEqual(sent, [1, 3], "2 is superseded, 3 (the latest) is never dropped");
  assert.deepEqual(server.row, { v: 1, gen: 0, rev: 2, data: { coins: 3 } });
});

test("a 409 stops the queue until rebase (written elsewhere)", async () => {
  const server = fakeServer();
  const { q, sent } = wired(server);
  await q.push({ coins: 1 });
  server.put({ save: { coins: 50 }, gen: 0, rev: 1 }); // another window
  await q.push({ coins: 2 });
  assert.match(q.stopped!, /elsewhere/);
  await q.push({ coins: 3 });
  assert.deepEqual(sent, [1, 2]);
  assert.deepEqual((server.row as { data: unknown }).data, { coins: 50 });
  q.rebase(0, 2);
  await q.push({ coins: 4 });
  assert.deepEqual((server.row as { data: unknown }).data, { coins: 4 });
});

test("bug 3: a damaged stored save is never overwritten until Start fresh", async () => {
  const damaged = { coins: "lots", note: "hand edited" };
  const server = fakeServer(damaged);
  const st = readStored(server.row, validate);
  assert.ok(st.damaged);
  assert.equal(st.data, damaged, "returned whole so the player can download it");
  const { q } = wired(server);
  q.rebase(st.gen, st.rev);
  await q.push({ coins: 0 }, true); // e.g. the save on close
  assert.equal(server.row, damaged);
  assert.match(q.stopped!, /damaged/);
  await q.reset(async () => server.del()); // the explicit Start fresh
  await q.push({ coins: 0 });
  assert.deepEqual(server.row, { v: 1, gen: 1, rev: 1, data: { coins: 0 } });
});

test("Planet Forge validation (as wired in the registry) plugs into the envelope", () => {
  const validateSave = (raw: unknown) => { const r = parseSave(raw); return r.ok ? { ok: true as const } : { ok: false as const, error: r.error }; };
  assert.match(readStored({ v: 1, gen: 0, rev: 0, data: { format: "nope" } }, validateSave).damaged!, /not a Planet Forge save/);
});
