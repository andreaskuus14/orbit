// STUDIO desktop notifications: pure diff + rate limit over GET /api/studio/clips snapshots (no DOM; tested in tests/studio-notify.test.ts).
// Used by src/components/StudioNotifier.tsx. State is JSON so it survives restarts in localStorage.

export type Cat = "ready" | "failed" | "blocked" | "live";
export const CATS: Cat[] = ["ready", "failed", "blocked", "live"];
export const RATE_MS = 10 * 60_000; // at most one notification per category per 10 min; the rest are batched into the next one

type Item = { key: string; name: string };
type ClipsLike = {
  jobs?: { id: string; source: string; status: string; clips: { id: string; title: string; status: string; publish?: { status: string; scheduledFor?: string } }[] }[];
  downloads?: { id: string; url: string; status: string; error?: string; file?: string }[];
};
export type NotifyState = {
  seen: Record<Cat, string[]> | null; // null = never polled: the first snapshot is a baseline, nothing is announced
  pending: Partial<Record<Cat, { n: number; names: string[] }>>;
  last: Partial<Record<Cat, number>>;
};
export type Note = { cat: Cat; n: number; title: string; body: string; spoken: string };

export const emptyState = (): NotifyState => ({ seen: null, pending: {}, last: {} });
const BLOCKED = /not a bot|blocked the download/i; // the bot-wall error factory/pure.ts writes; YouTube downloads are then paused

const stem = (f: string) => f.replace(/\.[^.]+$/, "");

/** The things worth telling the owner about right now, per category. */
export function snapshot(data: ClipsLike, now: number): Record<Cat, Item[]> {
  const out: Record<Cat, Item[]> = { ready: [], failed: [], blocked: [], live: [] };
  for (const j of data.jobs ?? []) {
    if (j.status === "failed") out.failed.push({ key: `job:${j.id}`, name: stem(j.source) });
    for (const c of j.clips ?? []) {
      if (c.status === "ready") out.ready.push({ key: `${j.id}/${c.id}`, name: stem(j.source) });
      const at = Date.parse(c.publish?.scheduledFor ?? "");
      if (c.publish?.status === "scheduled" && at <= now) out.live.push({ key: `${j.id}/${c.id}`, name: c.title });
    }
  }
  for (const d of data.downloads ?? []) {
    if (d.status !== "failed") continue;
    const name = d.file ? stem(d.file) : d.url;
    if (BLOCKED.test(d.error ?? "")) out.blocked.push({ key: `dl:${d.id}`, name });
    else out.failed.push({ key: `dl:${d.id}`, name });
  }
  return out;
}

const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const word = (n: number) => WORDS[n] ?? String(n);
const names = (xs: string[]) => (xs.length > 1 ? `${xs[0]} +${xs.length - 1} more` : xs[0] ?? "");

export function noteFor(cat: Cat, n: number, xs: string[]): Note {
  const s = n === 1 ? "" : "s", who = names(xs);
  if (cat === "ready") return { cat, n, title: `☀ ${n} new clip${s} ready — ${who}`, body: "Open STUDIO to review them.", spoken: `${word(n)} new clip${s} ${n === 1 ? "is" : "are"} ready.` };
  if (cat === "failed") return { cat, n, title: n === 1 ? `A clip job failed — ${who}` : `${n} clip jobs failed — ${who}`, body: "Open the clip factory to see why.", spoken: n === 1 ? "A clip job failed." : `${word(n)} clip jobs failed.` };
  if (cat === "blocked") return { cat, n, title: "YouTube blocked a download — downloads paused", body: `${who}. They resume on their own in a few hours.`, spoken: "YouTube blocked a download, so downloads are paused." };
  return { cat, n, title: n === 1 ? `📺 Your Short is live — ${who}` : `📺 ${n} Shorts went live — ${who}`, body: "Scheduled publish time passed.", spoken: n === 1 ? "Your scheduled Short is live." : `${word(n)} scheduled Shorts are live.` };
}

/** One poll: diff against what was seen, queue new items, emit at most one note per category per RATE_MS. */
export function step(state: NotifyState, data: ClipsLike, now: number): { state: NotifyState; notes: Note[] } {
  const cur = snapshot(data, now);
  const seen = Object.fromEntries(CATS.map((c) => [c, cur[c].map((i) => i.key)])) as Record<Cat, string[]>;
  if (!state.seen) return { state: { seen, pending: {}, last: {} }, notes: [] };
  const pending = { ...state.pending }, last = { ...state.last }, notes: Note[] = [];
  for (const c of CATS) {
    const old = new Set(state.seen[c] ?? []), fresh = cur[c].filter((i) => !old.has(i.key));
    if (fresh.length) {
      const p = pending[c] ?? { n: 0, names: [] };
      pending[c] = { n: p.n + fresh.length, names: [...new Set([...p.names, ...fresh.map((i) => i.name)])] };
    }
    const p = pending[c];
    if (p && p.n > 0 && now - (last[c] ?? 0) >= RATE_MS) { notes.push(noteFor(c, p.n, p.names)); last[c] = now; delete pending[c]; }
  }
  return { state: { seen, pending, last }, notes };
}

/** localStorage text → state; anything unreadable starts over (a fresh baseline, so a broken store never floods). */
export function parseState(raw: string | null): NotifyState {
  try {
    const o = JSON.parse(raw ?? "");
    if (o && typeof o === "object" && (o.seen === null || CATS.every((c) => Array.isArray(o.seen?.[c]))) && o.pending && o.last) return o as NotifyState;
  } catch { /* fall through */ }
  return emptyState();
}
