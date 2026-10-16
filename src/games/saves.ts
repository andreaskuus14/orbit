// Game Lab save envelope and write rules. Pure and server-safe: the API route enforces them, the game uses the queue.
// Stored in game_saves.save as { v: 1, gen, rev, data }. `gen` goes up on every reset; `rev` on every write within a gen.
// A reset stores a tombstone (data: null, gen + 1) instead of null, so a save that was in flight before the reset is
// rejected (its gen is older) instead of resurrecting the deleted game. Rows written before envelopes count as gen 0, rev 0.

export type Envelope = { v: 1; gen: number; rev: number; data: unknown };
export type Stored = { gen: number; rev: number; data: unknown; damaged: string | null };
type Validate = (raw: unknown) => { ok: true } | { ok: false; error: string };

const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

/** Reads a stored row's save column. `damaged` is set when there is data but it fails the game's validation. */
export function readStored(raw: unknown, validate: Validate): Stored {
  if (raw == null) return { gen: 0, rev: 0, data: null, damaged: null };
  const o = raw as Record<string, unknown>;
  const env = typeof raw === "object" && !Array.isArray(raw) && o.v === 1 && count(o.gen) && count(o.rev) && "data" in o;
  // Anything that isn't a well-formed envelope is kept whole as (legacy or damaged) data, so nothing is lost.
  const s: Stored = env ? { gen: o.gen as number, rev: o.rev as number, data: o.data ?? null, damaged: null } : { gen: 0, rev: 0, data: raw, damaged: null };
  if (s.data != null) { const v = validate(s.data); if (!v.ok) s.damaged = v.error; }
  return s;
}

export type PutPlan = { ok: true; save: Envelope } | { ok: false; status: 400 | 409; error: string };

/** Decides a save write. Body: { save, gen, rev } where gen/rev are what the client last read or wrote. */
export function planPut(storedRaw: unknown, body: Record<string, unknown>, validate: Validate): PutPlan {
  if (!count(body.gen) || !count(body.rev)) return { ok: false, status: 400, error: "Save has no revision. Reload the game." };
  const v = validate(body.save);
  if (!v.ok) return { ok: false, status: 400, error: `Save rejected: ${v.error}` };
  const s = readStored(storedRaw, validate);
  if (body.gen < s.gen) return { ok: false, status: 409, error: "This game was reset after this save started. Reload to keep saving." };
  if (body.gen > s.gen || body.rev !== s.rev) return { ok: false, status: 409, error: "Your save changed elsewhere (another window?). Reload to keep saving." };
  if (s.damaged) return { ok: false, status: 409, error: "Your stored save is damaged. Download it or choose Start fresh first." };
  return { ok: true, save: { v: 1, gen: s.gen, rev: s.rev + 1, data: body.save } };
}

/** What a reset stores: no data, next generation. */
export const tombstone = (storedRaw: unknown): Envelope => ({ v: 1, gen: readStored(storedRaw, () => ({ ok: true })).gen + 1, rev: 0, data: null });

// ---------- client save queue ----------
export type SendResult = { ok: true; rev: number } | { ok: false; conflict: boolean; error: string };
export type Send<T> = (snapshot: T, base: { gen: number; rev: number }, keepalive: boolean) => Promise<SendResult>;

/**
 * One save at a time; while one is in flight only the newest snapshot waits (older ones are superseded, never the latest).
 * After a conflict (409) it stops until rebase() (i.e. a reload). reset() makes sure nothing from before the reset is sent after it.
 * shortcut: a keepalive save queued behind an in-flight one is sent only when that finishes, so if the tab is killed
 * in between it is lost; upgrade by sending it at once with rev + 1 if that turns out to matter.
 */
export function createSaveQueue<T>(send: Send<T>) {
  let base = { gen: 0, rev: 0 };
  let pending: { snap: T; keepalive: boolean } | null = null;
  let running: Promise<void> | null = null;
  let stopped: string | null = null;
  let holding = false; // during reset(): pushes wait (and are then dropped) instead of sending

  async function drain() {
    while (pending && !stopped) {
      const { snap, keepalive } = pending;
      pending = null;
      const sentGen = base.gen;
      let r: SendResult;
      try { r = await send(snap, { ...base }, keepalive); } catch (e) { r = { ok: false, conflict: false, error: e instanceof Error ? e.message : "Save failed" }; }
      if (base.gen !== sentGen) continue; // a reset happened meanwhile; this result is about the old game
      if (r.ok) base = { gen: base.gen, rev: r.rev };
      else if (r.conflict) { stopped = r.error; pending = null; }
    }
  }
  function kick() {
    if (!running && !holding) running = drain().finally(() => { running = null; if (pending && !stopped) kick(); });
    return running;
  }

  return {
    /** Queue a snapshot; resolves when it (or a newer one) has been handled. No-op once stopped. */
    push(snap: T, keepalive = false): Promise<void> {
      if (stopped) return Promise.resolve();
      pending = { snap, keepalive: keepalive || !!pending?.keepalive };
      return kick() ?? Promise.resolve();
    },
    /** Wait until nothing is queued or in flight. */
    async flush() { while (running) await running; },
    /** Drop anything queued, wait for the in-flight save, run the reset (returns the new gen), then start from rev 0. */
    async reset(doReset: () => Promise<number>) {
      holding = true;
      pending = null;
      try {
        await this.flush();
        const gen = await doReset();
        base = { gen, rev: 0 };
        stopped = null;
      } finally { holding = false; pending = null; } // a snapshot queued during the reset holds the old game
    },
    /** After a (re)load: the stored gen/rev to build on. */
    rebase(gen: number, rev: number) { pending = null; base = { gen, rev }; stopped = null; },
    get stopped() { return stopped; },
    get base() { return { ...base }; },
  };
}
