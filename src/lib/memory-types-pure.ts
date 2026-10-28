// Memory types (roadmap 24–26), pure. Derived from fields that already exist (kind, source, confirmation from migration 0019,
// tags, created_at, text): no new columns. Conventions in `tags`: "superseded" = the pre-correction copy (history only),
// "corrects:<id>" = a scoped correction of <id>, "scope:<project>" = only true inside that project.
// Tested in tests/memory-types.test.ts.

export type MemoryType = "preference" | "fact" | "temporary" | "observation" | "inferred" | "superseded";
export type Scope = { kind: "global" | "chat" | "project"; project?: string; expiresAt: number | null };
export type Typed = {
  kind?: string; source?: string | null; confirmation?: string | null; tags?: string[] | null; folder?: string | null;
  created_at: string; content?: string; statement?: string; status?: string; supersedes?: string | null;
};
export type Ctx = { now: number; project?: string };

const DAY = 86_400_000, HOUR = 3_600_000;
const OWNER = /^(?:capture|upload|url|user_said|owner|core|chat|phone|call)$/;
const PREF = /^(?:i\s+(?:\w+\s+)?(?:prefer|like|love|enjoy|hate|dislike|want|always|never|usually|don'?t|do not|no longer)|(?:please\s+)?(?:stop|never|always|don'?t|do not))\b/i;
const UNITS: Record<string, number> = { hour: HOUR, day: DAY, week: 7 * DAY, month: 30 * DAY };
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, few: 3, couple: 2 };

/** Expiry and scope of a temporary instruction ("for now", "today", "this week", "for the next 3 days", "until 2026-11-02",
 *  "in this chat", "for this project"); null when the text has no time cue, i.e. it is durable. */
export function temporaryOf(text: string, createdAt: string, project?: string | null): Scope | null {
  const t = text.toLowerCase(), at = Date.parse(createdAt) || 0;
  const chat = /\b(?:in|for) this (?:chat|conversation)\b/.test(t), proj = /\b(?:in|for|on) this project\b/.test(t);
  let ttl: number | null = null;
  let m: RegExpExecArray | null;
  if ((m = /\buntil (\d{4}-\d{2}-\d{2})\b/.exec(t)) && Date.parse(m[1])) return { ...scopeOf(chat, proj, project), expiresAt: Date.parse(m[1]) + DAY };
  if ((m = /\bfor the next (\d+|a|an|one|two|three|four|five|six|seven|ten|few|couple(?: of)?) (hour|day|week|month)s?\b/.exec(t))) ttl = (Number(m[1]) || NUM[m[1].split(" ")[0]] || 1) * UNITS[m[2]];
  else if (/\b(?:today|tonight|right now)\b/.test(t)) ttl = DAY;
  else if (/\buntil tomorrow\b/.test(t)) ttl = 2 * DAY;
  else if (/\bthis week\b/.test(t)) ttl = 7 * DAY;
  else if (/\bthis month\b/.test(t)) ttl = 31 * DAY;
  // shortcut: "for now" has no stated end, so it lapses after a week; ask the owner to re-confirm if that proves short.
  else if (/\b(?:for now|for the time being|temporarily|for a while|until further notice)\b/.test(t)) ttl = 7 * DAY;
  else if (chat) ttl = 12 * HOUR; // shortcut: no chat id on records, so "in this chat" lapses after 12 h.
  else if (proj) return { ...scopeOf(false, true, project), expiresAt: null }; // project-scoped but not time-bound
  return ttl === null ? null : { ...scopeOf(chat, proj, project), expiresAt: at + ttl };
}
const scopeOf = (chat: boolean, proj: boolean, project?: string | null): Omit<Scope, "expiresAt"> =>
  chat ? { kind: "chat" } : proj && project ? { kind: "project", project } : { kind: "global" };

const tagged = (r: Typed, p: string) => (r.tags ?? []).find((t) => t.startsWith(p))?.slice(p.length);
const textOf = (r: Typed) => r.statement ?? r.content ?? "";
const projectOf = (r: Typed) => tagged(r, "scope:") ?? r.folder ?? null;

/** One type per record. Memories: kind/source/confirmation; beliefs (memory_facts): source user_said/inferred/document. */
export function memoryType(r: Typed): MemoryType {
  if ((r.tags ?? []).includes("superseded") || r.status === "superseded" || r.status === "retracted") return "superseded";
  if (r.source === "inferred" || r.confirmation === "suggested") return "inferred";
  if (r.source === "document" || (r.source && !OWNER.test(r.source))) return "observation";
  if (temporaryOf(textOf(r).slice(0, 400), r.created_at)) return "temporary";
  return r.kind === "preference" || PREF.test(textOf(r).trim()) ? "preference" : "fact";
}

/** Scope of a record: explicit "scope:" tag, else what its temporary wording says, else global and open-ended. */
export function scopeOfRecord(r: Typed): Scope {
  const tag = tagged(r, "scope:");
  const temp = temporaryOf(textOf(r).slice(0, 400), r.created_at, projectOf(r));
  if (tag) return { kind: "project", project: tag, expiresAt: temp?.expiresAt ?? null };
  return temp ?? { kind: "global", expiresAt: null };
}

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
/** Usable as current truth here and now: not history, not expired, and inside its scope. */
export function isCurrent(r: Typed, ctx: Ctx): boolean {
  if (memoryType(r) === "superseded") return false;
  const s = scopeOfRecord(r);
  if (s.expiresAt !== null && s.expiresAt <= ctx.now) return false;
  return s.kind !== "project" || same(s.project, ctx.project);
}

/** Retrieval filter (25): drop history copies, expired/out-of-scope records, and anything a current correction replaces. */
export function currentOnly<T extends Typed & { id: string }>(rows: T[], ctx: Ctx): T[] {
  const live = rows.filter((r) => isCurrent(r, ctx));
  const replaced = new Set(live.map((r) => tagged(r, "corrects:")).filter(Boolean) as string[]);
  return live.filter((r) => !replaced.has(r.id));
}

/** The attribute CORE sees on a memory, e.g. type="inferred (unconfirmed guess)". "" for plain confirmed facts. */
export function typeLabel(r: Typed): string {
  const t = memoryType(r), s = scopeOfRecord(r);
  if (t === "inferred") return ' type="inferred belief (a guess, not confirmed)"';
  if (t === "temporary") return ` type="temporary instruction${s.expiresAt ? ` until ${new Date(s.expiresAt).toISOString().slice(0, 10)}` : ""}${s.kind === "project" ? ` in ${s.project}` : ""}"`;
  if (t === "observation") return ' type="observation"';
  return t === "preference" ? ' type="preference"' : "";
}

// ---------- contradictions (26) ----------
/** Explicit correction 4 > owner-stated preference/fact 3 > observation 2 > inferred 1. */
export function weight(r: Typed): number {
  if (tagged(r, "corrects:") || r.source === "correction" || (r.source === "user_said" && r.supersedes)) return 4;
  const t = memoryType(r);
  return t === "inferred" ? 1 : t === "observation" ? 2 : t === "superseded" ? 0 : 3;
}

/** Which claim stands, or null = ask "Which is right?". Higher weight wins outright (so a newer observation never beats a
 *  durable preference); a tie between observations/guesses goes to the newest; a tie between owner statements is asked. */
export function resolveClaims<T extends { weight: number; at: string }>(opts: T[]): T | null {
  if (opts.length < 2) return opts[0] ?? null;
  const top = Math.max(...opts.map((o) => o.weight)), best = opts.filter((o) => o.weight === top);
  if (best.length === 1) return best[0];
  return top <= 2 ? [...best].sort((a, b) => b.at.localeCompare(a.at))[0] : null;
}
