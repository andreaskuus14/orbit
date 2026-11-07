// Memory types (roadmap 24–26), pure. Derived from fields that already exist (kind, source, confirmation from migration 0019,
// tags, created_at, text): no new columns. Conventions in `tags`: "superseded" = the pre-correction copy (history only),
// "corrects:<id>" = a scoped correction of <id>, "scope:<project>" = only true inside that project, "chat:<id>" = only true
// in the chat it was said in (id without dashes, fits the 40-char tag limit), "until:revoked" / "until:YYYY-MM-DD" = the
// owner's edit of how long it lasts (overrides the wording), "revoked" = the owner ended it.
// Tested in tests/memory-types.test.ts.

export type MemoryType = "preference" | "fact" | "temporary" | "observation" | "inferred" | "superseded";
export type Scope = { kind: "global" | "chat" | "project"; project?: string; chat?: string; expiresAt: number | null; until?: Until };
/** How long a temporary instruction lasts: until revoked, end of today (Europe/Tallinn), N days, until a date, or "for now". */
export type Until = "revoked" | "today" | "days" | "date" | "now";
export type Typed = {
  kind?: string; source?: string | null; confirmation?: string | null; tags?: string[] | null; folder?: string | null;
  created_at: string; content?: string; statement?: string; status?: string; supersedes?: string | null;
};
/** legacy: an old name-based scope still honoured here, set only when that name identifies exactly one owned project.
 *  since = that project's creation: an older name-tagged memory belonged to an earlier (deleted) project of the same name. */
export type Legacy = { name: string; since: string };
export type Ctx = { now: number; project?: string; chat?: string; legacy?: Legacy };

const DAY = 86_400_000, HOUR = 3_600_000;
const OWNER = /^(?:capture|upload|url|user_said|owner|core|chat|phone|call)$/;
const PREF = /^(?:i\s+(?:\w+\s+)?(?:prefer|like|love|enjoy|hate|dislike|want|always|never|usually|don'?t|do not|no longer)|(?:please\s+)?(?:stop|never|always|don'?t|do not))\b/i;
const UNITS: Record<string, number> = { hour: HOUR, day: DAY, week: 7 * DAY, month: 30 * DAY };
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, few: 3, couple: 2 };

const TZ = "Europe/Tallinn";
const offset = (t: number) => { // Tallinn wall clock minus UTC at instant t
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(t);
  const g = (k: string) => Number(p.find((x) => x.type === k)?.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(t / 1000) * 1000;
};
/** The instant Tallinn's wall clock reads 00:00 on the UTC calendar date of `utcMidnight` (DST never switches at midnight there). */
const tallinnMidnight = (utcMidnight: number) => utcMidnight - offset(utcMidnight - offset(utcMidnight));
/** End of the Europe/Tallinn calendar day that contains `at` (+ `extra` days). */
export function tallinnDayEnd(at: number, extra = 0): number {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(at).split("-").map(Number);
  return tallinnMidnight(Date.UTC(y, m - 1, d + 1 + extra));
}

// Estonian cues; \b is ASCII-only in JS, so word edges are lookarounds on letters.
const ET = (src: string) => new RegExp(`(?<!\\p{L})(?:${src})(?!\\p{L})`, "u");
const ET_CHAT = ET("(?:selles|siin|sinu) (?:vestluses|chatis|jutus)|selle vestluse (?:ajal|jooksul)");
const ET_PROJ = ET("selles projektis|selle projekti (?:jaoks|puhul|juures)");
const ET_REVOKED = ET("kuni edasiseni|kuni uue teateni|kuni ma (?:ütlen|teisiti ütlen)|kuni tühistan");
const ET_TODAY = ET("täna|tänaseks|tänasel päeval|täna õhtul|täna öösel");
const ET_TOMORROW = ET("homseni|kuni homseni");
const ET_WEEK = ET("sel nädalal|selle nädala jooksul|selleks nädalaks");
const ET_MONTH = ET("sel kuul|selle kuu jooksul");
const ET_NOW = ET("esialgu|ajutiselt|praegu|hetkel|mõnda aega");
const ET_DAYS = /(?<!\p{L})(?:järgmised |järgmise )?(\d+|üks|kaks|kolm|neli|viis|kuus|seitse|kümme) (päeva(?:ks| jooksul)?|nädala(?:ks| jooksul)?|tunni(?:ks| jooksul)?|tundi|kuu(?:ks| jooksul)?)(?!\p{L})/u;
const ET_NUM: Record<string, number> = { üks: 1, kaks: 2, kolm: 3, neli: 4, viis: 5, kuus: 6, seitse: 7, kümme: 10 };
const ET_UNIT = (u: string) => u.startsWith("päev") ? DAY : u.startsWith("nädal") ? 7 * DAY : u.startsWith("kuu") ? 30 * DAY : HOUR;

/** Scope and expiry of a temporary instruction, English or Estonian ("for now", "today"/"täna", "this week", "for the next 3
 *  days"/"järgmised 3 päeva", "until 2026-11-02"/"kuni 2026-11-02", "until further notice"/"kuni edasiseni", "in this
 *  chat"/"selles vestluses", "for this project"); null when the text has no time or scope cue, i.e. it is durable.
 *  "today" ends at the Europe/Tallinn date boundary; "until further notice" never lapses on its own (until revoked). */
export function temporaryOf(text: string, createdAt: string, project?: string | null, chatId?: string | null): Scope | null {
  const t = text.toLowerCase(), at = Date.parse(createdAt) || 0;
  const chat = /\b(?:in|for) this (?:chat|conversation)\b/.test(t) || ET_CHAT.test(t), proj = /\b(?:in|for|on) this project\b/.test(t) || ET_PROJ.test(t);
  const scope = scopeOf(chat, proj, project, chatId);
  const out = (until: Until, expiresAt: number | null): Scope => ({ ...scope, expiresAt, until });
  let m: RegExpExecArray | null;
  if ((m = /(?:\buntil|(?<!\p{L})kuni) (\d{4}-\d{2}-\d{2})\b/u.exec(t)) && Date.parse(m[1])) return out("date", tallinnMidnight(Date.parse(m[1]) + DAY));
  if (/\buntil (?:further notice|i say otherwise|i say so|revoked|cancelled)\b/.test(t) || ET_REVOKED.test(t)) return out("revoked", null);
  if ((m = /\bfor the next (\d+|a|an|one|two|three|four|five|six|seven|ten|few|couple(?: of)?) (hour|day|week|month)s?\b/.exec(t))) return out("days", at + (Number(m[1]) || NUM[m[1].split(" ")[0]] || 1) * UNITS[m[2]]);
  if ((m = ET_DAYS.exec(t))) return out("days", at + (Number(m[1]) || ET_NUM[m[1]] || 1) * ET_UNIT(m[2]));
  if (/\buntil tomorrow\b/.test(t) || ET_TOMORROW.test(t)) return out("today", tallinnDayEnd(at, 1));
  if (/\b(?:today|tonight|right now)\b/.test(t) || ET_TODAY.test(t)) return out("today", tallinnDayEnd(at));
  if (/\bthis week\b/.test(t) || ET_WEEK.test(t)) return out("days", at + 7 * DAY);
  if (/\bthis month\b/.test(t) || ET_MONTH.test(t)) return out("days", at + 31 * DAY);
  // shortcut: "for now" states no end, so it lapses after a week (shown with its date, editable via an until: tag).
  if (/\b(?:for now|for the time being|temporarily|for a while)\b/.test(t) || ET_NOW.test(t)) return out("now", at + 7 * DAY);
  return chat || proj ? out("revoked", null) : null; // scoped but not time-bound
}
const scopeOf = (chat: boolean, proj: boolean, project?: string | null, chatId?: string | null): Omit<Scope, "expiresAt"> =>
  chat ? { kind: "chat", ...(chatId ? { chat: chatId } : {}) } : proj ? { kind: "project", ...(project ? { project } : {}) } : { kind: "global" };
const chatKey = (id?: string | null) => (id ?? "").toLowerCase().replace(/-/g, "");
/** Stable project scope for new memories: the project's ID, so same/similar names and renames can't share or lose it.
 *  "scope:p:" + 32 hex = 40 chars, the tag cap. */
export const projectScopeKey = (id: string) => `p:${chatKey(id)}`;
const KEY = /^p:[0-9a-f]{32}$/;
/** How older CORE builds tagged a project: its display name, lower-cased by matching and cut to 34 chars by the tag cap. */
export const legacyScopeKey = (name: string) => name.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 34);

/** Tags that pin a newly saved memory to where it was said: "chat:<id>" for chat-scoped wording, "scope:<project>" for
 *  project-scoped wording. Caller-supplied chat:/until:/revoked tags are dropped (a model must not widen or forge scope). */
export function scopeTags(text: string, tags: string[] | undefined, ctx: { chat?: string | null; project?: string | null }): string[] {
  const own = (tags ?? []).filter((x) => !/^(?:chat:|scope:|until:|revoked$)/.test(x)); // scope comes from where it was said, never from the caller
  const s = temporaryOf(text.slice(0, 400), new Date().toISOString(), ctx.project, ctx.chat);
  if (s?.kind === "chat") own.push(`chat:${chatKey(ctx.chat) || "unknown"}`); // no chat id: fails closed (eligible nowhere)
  else if (s?.kind === "project") own.push(`scope:${s.project ?? ""}`.slice(0, 40)); // no project id: empty scope fails closed, including title-only cues
  return own;
}

const tagged = (r: Typed, p: string) => (r.tags ?? []).find((t) => t.startsWith(p))?.slice(p.length);
const textOf = (r: Typed) => r.statement ?? r.content ?? "";
const projectOf = (r: Typed) => tagged(r, "scope:") ?? r.folder ?? null;

/** One type per record. Memories: kind/source/confirmation; beliefs (memory_facts): source user_said/inferred/document. */
export function memoryType(r: Typed): MemoryType {
  if ((r.tags ?? []).some((x) => x === "superseded" || x === "revoked") || r.status === "superseded" || r.status === "retracted") return "superseded";
  if (r.source === "inferred" || r.confirmation === "suggested") return "inferred";
  if (r.source === "document" || (r.source && !OWNER.test(r.source))) return "observation";
  if (scopeOfRecord(r).until) return "temporary";
  return r.kind === "preference" || PREF.test(textOf(r).trim()) ? "preference" : "fact";
}

/** Scope of a record: explicit "chat:"/"scope:" tag, else what its wording says, else global and open-ended; an owner's
 *  "until:" tag replaces the expiry the wording implied. Chat summaries describe a chat; they are not instructions. */
export function scopeOfRecord(r: Typed): Scope {
  const tag = tagged(r, "scope:"), chat = tagged(r, "chat:"), until = tagged(r, "until:");
  const temp = r.kind === "conversation" ? null : temporaryOf(textOf(r).slice(0, 400), r.created_at, projectOf(r));
  const base: Scope = chat !== undefined || temp?.kind === "chat" ? { ...temp, kind: "chat", chat: chat || undefined, expiresAt: temp?.expiresAt ?? null }
    : tag !== undefined ? { ...temp, kind: "project", project: tag || undefined, expiresAt: temp?.expiresAt ?? null }
    : temp ?? { kind: "global", expiresAt: null };
  if (until === "revoked") return { ...base, until: "revoked", expiresAt: null };
  if (until && /^\d{4}-\d{2}-\d{2}$/.test(until) && Date.parse(until)) return { ...base, until: "date", expiresAt: tallinnMidnight(Date.parse(until) + DAY) };
  return base;
}

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
/** Usable as current truth here and now: not history, not expired, and inside its scope. */
export function isCurrent(r: Typed, ctx: Ctx): boolean {
  if (memoryType(r) === "superseded") return false;
  const s = scopeOfRecord(r);
  if (s.expiresAt !== null && s.expiresAt <= ctx.now) return false;
  if (s.kind === "chat") return !!s.chat && s.chat === chatKey(ctx.chat); // no originating chat id, or another chat: never
  if (s.kind !== "project") return true;
  if (same(s.project, ctx.project)) return true;
  return !!ctx.legacy && !!s.project && !KEY.test(s.project) && legacyScopeKey(s.project) === legacyScopeKey(ctx.legacy.name)
    && Date.parse(r.created_at) >= Date.parse(ctx.legacy.since); // NaN (missing/bad date) fails closed
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
  if (t === "temporary") return ` type="temporary instruction${s.expiresAt ? ` until ${new Date(s.expiresAt - 1).toLocaleDateString("en-CA", { timeZone: TZ })}` : " until revoked"}${s.kind === "project" ? s.project ? ` in ${s.project}` : " in this project only" : s.kind === "chat" ? " in this chat only" : ""}"`;
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
