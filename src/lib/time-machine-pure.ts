// TIME MACHINE: one timeline of everything ORBIT did (jobs, files, memory, settings, agent actions, sends), by day, with one-click
// Undo where it can be undone and Undo of the Undo (redo). Pure: records, inversion, the "still as ORBIT left it?" checks, the
// journal redaction and the timeline entries. IO: time-machine.ts; API: /api/time-machine; UI: TimeMachineView (OPERATIONS).
//
// A record is one change set ORBIT made, with each thing's state before and after. Undo never edits a record: it applies the
// "before" states and writes a NEW record (before/after swapped, undid = the record it reversed), so undoing that one is a redo.
// A change is only reversed while the thing is still exactly as the record left it (else "changed since": nothing is clobbered).
// Journal / LIFE: never recorded with content; on the timeline only "Journal entry · <day>" (no text, no detail, no Undo).
import type { ActItem, ActUndo } from "./activity-pure.ts";
import { undoKey } from "./activity-pure.ts";
import { isPrivate, isPrivateKind } from "./private-pure.ts";
import type { Progress } from "./progress-pure.ts";
import type { Lang } from "./i18n-core-pure.ts";

export const TM_MAX = 2000; // records kept
export const TM_TZ = "Europe/Tallinn";

/** A memory row's own fields (never the embedding). */
export type MemState = { kind: string; title: string; content: string | null; tags: string[]; source: string | null };
/** VAULT file: by its current name, or sitting in VAULT's trash (restorable). null = not there. */
export type VaultState = { name: string } | { trash: string; name: string } | null;
/** A MEMORY link (memory_links row) between two memories: dream mode's "these belong together". null = no such row. */
export type LinkState = { from: string; to: string; status: "suggested" | "confirmed"; reason: string } | null;
export type TmChange =
  | { t: "file"; ws: string; path: string; before: string | null; after: string | null }           // workspace file: content sha256 (blob) or absent
  | { t: "vault"; before: VaultState; after: VaultState }
  | { t: "memory"; id: string; before: MemState | null; after: MemState | null }                     // null = row absent
  | { t: "link"; id: string; before: LinkState; after: LinkState }                                   // memory_links row by id
  | { t: "setting"; key: string; before: string; after: string }                                     // "autonomy:<area>" → level
  | { t: "branch"; name: string; before: string | null; after: string | null };                      // git branch → commit sha, or absent
export type TmKind = TmChange["t"];
export type TmRecord = { id: string; at: string; title: string; why?: string; changes: TmChange[]; undid?: string };

const SHA = /^[0-9a-f]{64}$/, GIT = /^[0-9a-f]{40}$/;
export const TM_ID = /^tm[0-9a-z]{8,40}$/;
const s = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

function cleanMem(m: unknown): MemState | null | undefined {
  if (m === null) return null;
  if (!m || typeof m !== "object") return undefined;
  const o = m as Record<string, unknown>;
  if (typeof o.kind !== "string" || typeof o.title !== "string") return undefined;
  return { kind: o.kind, title: o.title, content: typeof o.content === "string" ? o.content : null, tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === "string") : [], source: typeof o.source === "string" ? o.source : null };
}
function cleanVault(v: unknown): VaultState | undefined {
  if (v === null) return null;
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== "string" || !o.name.trim()) return undefined;
  if (o.trash !== undefined) return typeof o.trash === "string" && /^[\w-]{1,64}$/.test(o.trash) ? { trash: o.trash, name: o.name } : undefined;
  return { name: o.name };
}
const UUIDISH = /^[\w-]{1,64}$/;
function cleanLink(v: unknown): LinkState | undefined {
  if (v === null) return null;
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.from !== "string" || typeof o.to !== "string" || !UUIDISH.test(o.from) || !UUIDISH.test(o.to) || o.from === o.to) return undefined;
  if (o.status !== "suggested" && o.status !== "confirmed") return undefined;
  return { from: o.from, to: o.to, status: o.status, reason: s(o.reason, 300) };
}
const shaOrNull = (v: unknown, re: RegExp) => (v === null ? null : typeof v === "string" && re.test(v) ? v : undefined);

/** Untrusted stored change → a valid one, or undefined. */
export function cleanChange(c: unknown): TmChange | undefined {
  if (!c || typeof c !== "object") return undefined;
  const o = c as Record<string, unknown>;
  if (o.t === "file") {
    const before = shaOrNull(o.before, SHA), after = shaOrNull(o.after, SHA);
    if (before === undefined || after === undefined || typeof o.ws !== "string" || !/^[a-z0-9-]{1,60}$/.test(o.ws) || typeof o.path !== "string" || !o.path || o.path.length > 300) return undefined;
    return { t: "file", ws: o.ws, path: o.path, before, after };
  }
  if (o.t === "vault") {
    const before = cleanVault(o.before), after = cleanVault(o.after);
    return before === undefined || after === undefined ? undefined : { t: "vault", before, after };
  }
  if (o.t === "memory") {
    const before = cleanMem(o.before), after = cleanMem(o.after);
    if (before === undefined || after === undefined || typeof o.id !== "string" || !/^[\w-]{1,64}$/.test(o.id)) return undefined;
    return { t: "memory", id: o.id, before, after };
  }
  if (o.t === "link") {
    const before = cleanLink(o.before), after = cleanLink(o.after);
    if (before === undefined || after === undefined || typeof o.id !== "string" || !UUIDISH.test(o.id)) return undefined;
    return { t: "link", id: o.id, before, after };
  }
  if (o.t === "setting") {
    if (typeof o.key !== "string" || !/^autonomy:[\w-]{1,40}$/.test(o.key) || typeof o.before !== "string" || typeof o.after !== "string") return undefined;
    return { t: "setting", key: o.key, before: o.before.slice(0, 20), after: o.after.slice(0, 20) };
  }
  if (o.t === "branch") {
    const before = shaOrNull(o.before, GIT), after = shaOrNull(o.after, GIT);
    if (before === undefined || after === undefined || !isSafeBranch(o.name)) return undefined;
    return { t: "branch", name: o.name as string, before, after };
  }
  return undefined;
}
/** Only ORBIT's own code-fix branches can be put away or brought back (never main or the owner's branches). */
export const isSafeBranch = (n: unknown) => typeof n === "string" && /^night\/[\w./-]{1,100}$/.test(n) && !n.includes("..") && !n.endsWith(".lock");

/** JSONL → records (malformed lines and changes skipped; a record with no valid change is dropped). */
export function parseRecords(text: string): TmRecord[] {
  const out: TmRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (!o || typeof o.id !== "string" || !TM_ID.test(o.id) || typeof o.at !== "string" || Number.isNaN(Date.parse(o.at)) || typeof o.title !== "string") continue;
      const changes = (Array.isArray(o.changes) ? o.changes : []).map(cleanChange).filter((c: TmChange | undefined): c is TmChange => !!c);
      if (!changes.length) continue;
      out.push({ id: o.id, at: o.at, title: s(o.title, 300), ...(o.why ? { why: s(o.why, 300) } : {}), changes, ...(typeof o.undid === "string" && TM_ID.test(o.undid) ? { undid: o.undid } : {}) });
    } catch { /* skip */ }
  }
  return out;
}

/** Journal / LIFE data is never recorded: a journal memory, or a file whose name looks like the journal. */
export function recordable(c: TmChange): boolean {
  if (c.t === "memory") return ![c.before, c.after].some((m) => m && (isPrivate(m) || isJournalName(m.title)));
  if (c.t === "file") return !isJournalName(c.path) && !isJournalName(c.ws);
  if (c.t === "vault") return ![c.before, c.after].some((v) => v && isJournalName(v.name));
  return true;
}
/** Same names offline-tools-pure isJournalName refuses (kept here so the browser bundle stays small). */
const isJournalName = (v: unknown) => typeof v === "string" && /journal|p[äa]evik|diary|life\.json/i.test(v);

/** Ids of records some later record reversed. */
export const undoneIds = (recs: TmRecord[]) => new Set(recs.flatMap((r) => (r.undid ? [r.undid] : [])));
/** Can this record still be undone (nothing reversed it yet)? */
export const isOpen = (r: TmRecord, recs: TmRecord[]) => !undoneIds(recs).has(r.id);

/** The record that undoes `r`: same things, before/after swapped (reached: what applying actually produced, e.g. a trash id). */
export function inverse(r: TmRecord, id: string, at: string, reached: TmChange[] = r.changes.map(swap)): TmRecord {
  return { id, at, title: `${isUndoRecord(r) ? "Redone" : "Undone"}: ${r.title.replace(/^(Undone|Redone): /, "")}`, ...(r.why ? { why: r.why } : {}), changes: reached, undid: r.id };
}
/** An undo (its own Undo is a redo): it reversed a record, or it is the record an Activity-log undo wrote ("Undone: …"). */
export const isUndoRecord = (r: TmRecord) => /^Undone: /.test(r.title);
export function swap(c: TmChange): TmChange {
  return { ...c, before: c.after, after: c.before } as TmChange;
}

// ---- "is it still as ORBIT left it?" ----
export const LEVEL_RANK: Record<string, number> = { off: 0, ask: 1, do: 2, auto: 3 };
/** Current state of each thing (same order as changes), as the IO layer read it. */
export type Current =
  | { t: "file"; sha: string | null }
  | { t: "vault"; state: VaultState }            // the file by the expected name (or its trash item), null when gone
  | { t: "memory"; state: MemState | null }
  | { t: "link"; state: LinkState }
  | { t: "setting"; value: string | null }
  | { t: "branch"; sha: string | null };

export const memHash = (m: MemState | null) => (m ? JSON.stringify([m.kind, m.title, m.content ?? "", [...m.tags].sort()]) : "");
const linkHash = (l: LinkState) => (l ? `${l.from}|${l.to}|${l.status}` : "");
const sameVault = (a: VaultState, b: VaultState) => (a === null || b === null ? a === b : a.name === b.name && ("trash" in a ? a.trash : "") === ("trash" in b ? b.trash : ""));

/** "" = the change can be reversed now, else a plain reason. Settings only go back when that makes ORBIT ask more, never less. */
export function blockReason(c: TmChange, cur: Current): string {
  if (c.t !== cur.t) return "Something went wrong reading it";
  switch (c.t) {
    case "file": return (cur as { sha: string | null }).sha === c.after ? "" : `${c.path} changed since: open it to see`;
    case "vault": return sameVault((cur as { state: VaultState }).state, c.after) ? "" : "That VAULT file changed since";
    case "memory": return memHash((cur as { state: MemState | null }).state) === memHash(c.after) ? "" : "That memory changed since";
    case "link": return linkHash((cur as { state: LinkState }).state) === linkHash(c.after) ? "" : "That link changed since";
    case "branch": return (cur as { sha: string | null }).sha === c.after ? "" : `Branch ${c.name} moved since`;
    case "setting": {
      const v = (cur as { value: string | null }).value;
      if (v !== c.after) return "That setting changed since";
      if ((LEVEL_RANK[c.before] ?? 9) > (LEVEL_RANK[c.after] ?? 9)) return "That would let ORBIT do more on its own: change it back in Profile → Autonomy";
      return "";
    }
  }
}
/** First reason any change of the record can't be reversed ("" = all can). */
export function recordBlock(r: TmRecord, cur: Current[]): string {
  if (cur.length !== r.changes.length) return "Something went wrong reading it";
  for (let i = 0; i < r.changes.length; i++) { const b = blockReason(r.changes[i], cur[i]); if (b) return b; }
  return "";
}

/** The undo kinds that have a redo here (time machine records). Activity-only kinds (op, pc, term) undo once. */
export const kindOf = (r: TmRecord): TmKind => r.changes[0].t;

// ---- days ----
/** ISO time → "YYYY-MM-DD" in ORBIT's day (Europe/Tallinn). */
export function dayOf(iso: string, tz = TM_TZ): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export const isDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`));
/** A UTC window that surely covers the whole local day (±14 h); filter with dayOf after. */
export function dayWindow(day: string): { from: string; to: string } {
  const noon = Date.parse(`${day}T12:00:00Z`);
  return { from: new Date(noon - 26 * 3600_000).toISOString(), to: new Date(noon + 26 * 3600_000).toISOString() };
}
/** Distinct days, newest first. */
export const daysOf = (isos: string[], tz = TM_TZ, max = 120) => [...new Set(isos.map((i) => dayOf(i, tz)).filter(Boolean))].sort().reverse().slice(0, max);

// ---- the timeline ----
export type EntryKind = "job" | "file" | "memory" | "setting" | "agent" | "send" | "code" | "journal" | "system";
/** undo: how to reverse it (tm record id, or an Activity log undo). state: open = Undo offered; undone; sent = can't be undone. */
export type Entry = {
  id: string; at: string; day: string; kind: EntryKind; what: string; why?: string;
  undo?: { tm: string; redo: boolean } | { act: ActUndo; area: string };
  state: "open" | "done" | "undone" | "sent" | "private";
  link?: ActItem["link"];
};

/** Ledger events shown on the timeline (data never includes message text). Sends can't be undone. */
export type LedgerRow = { id?: string; type: string; created_at: string; data?: Record<string, unknown> | null };
const SENT: Record<string, (d: Record<string, unknown>) => string> = {
  "clip.published": (d) => `Published a clip${typeof d.title === "string" ? `: ${d.title}` : ""}`,
  "autonomy.act": (d) => (d.action === "publish" ? "Auto-published a Short" : "Auto-sent an email"),
  "invoice.reminder": () => "Sent an invoice reminder",
  "invoice.paylink": () => "Made a payment link",
  "higgsfield.spend": (d) => `Spent ${Number(d.credits) || 0} credits on a video`,
};
// (autonomy.change is not here: setAreaLevel writes a time-machine record, which is the entry and carries the Undo)
const LEDGER: Record<string, { kind: EntryKind; what: (d: Record<string, unknown>) => string }> = {
  "memory.hygiene": { kind: "memory", what: (d) => `Memory tidy-up ${d.action === "merge" ? "merge" : "retract"} ${d.decision === "accepted" ? "accepted" : "dismissed"}` },
  "contract.status": { kind: "agent", what: (d) => `Contract → ${s(d.to, 20)}` },
  "night.end": { kind: "job", what: (d) => `Night shift: ${Number(d.done) || 0} done, ${Number(d.failed) || 0} failed` },
};
const JOURNAL_EVENTS = new Set(["journal.saved", "life.habit"]);

export function ledgerEntries(rows: LedgerRow[], tz = TM_TZ): Entry[] {
  return rows.flatMap((r, i): Entry[] => {
    const d = r.data ?? {}, day = dayOf(r.created_at, tz), id = `ev:${r.id ?? `${r.created_at}-${i}`}`;
    if (!day) return [];
    if (JOURNAL_EVENTS.has(r.type) || (r.type === "memory.saved" && isPrivateKind(String(d.kind ?? "")))) return [privateEntry(id, r.created_at, day)];
    if (SENT[r.type]) return [{ id, at: r.created_at, day, kind: "send", what: SENT[r.type](d).slice(0, 200), state: "sent" }];
    const l = LEDGER[r.type];
    return l ? [{ id, at: r.created_at, day, kind: l.kind, what: l.what(d).slice(0, 200), state: "done" }] : [];
  });
}
export const privateEntry = (id: string, at: string, day: string): Entry => ({ id, at, day, kind: "journal", what: "Journal entry", state: "private" });

const SENT_TITLE = /^(Published|Scheduled|Uploading|Upload unclear|Sent|Auto-sent|Emailed|Posted):?\s/i;
const JOURNAL_TEXT = /journal|p[äa]evik|diary|\blife[_ ](?:plan|journal)|life\.json/i;
const areaKind = (a: string, title: string): EntryKind =>
  a === "agents" || a === "chains" || a === "goals" || a === "automations" ? "job"
  : a === "clips" || a === "autopilot" ? (SENT_TITLE.test(title) ? "send" : "job")
  : /\bmemory\b|save_memory/i.test(title) ? "memory" : /\bVAULT\b|ws_write|ws_edit|\bfile/i.test(title) ? "file"
  : /^PC: .*(edit|code)|night repair/i.test(title) ? "code" : a === "system" ? "system" : "agent";

/** Activity log items → entries. Lines that only record a time-machine undo are dropped (the record itself is the entry). */
export function activityEntries(items: ActItem[], recs: TmRecord[], tz = TM_TZ): Entry[] {
  const undone = undoneIds(recs), done = new Set(items.flatMap((x) => (x.undid ? [x.undid] : [])));
  return items.flatMap((x, i): Entry[] => {
    if (x.undid && x.undo?.kind === "tm") return []; // an undo that wrote a time-machine record: the record is the entry
    const day = dayOf(x.at, tz), id = `act:${x.at}-${i}`;
    if (!day) return [];
    if (JOURNAL_TEXT.test(x.title) || JOURNAL_TEXT.test(x.detail ?? "")) return [privateEntry(id, x.at, day)];
    const kind = areaKind(x.area, x.title);
    const base: Entry = { id, at: x.at, day, kind, what: x.title.slice(0, 200), ...(x.detail ? { why: x.detail.slice(0, 300) } : {}), state: kind === "send" ? "sent" : "done", ...(x.link ? { link: x.link } : {}) };
    if (!x.undo) return [base];
    if (x.undo.kind === "tm") return [{ ...base, undo: { tm: x.undo.id, redo: false }, state: undone.has(x.undo.id) ? "undone" : "open" }];
    return [{ ...base, undo: { act: x.undo, area: x.area }, state: done.has(undoKey(x.undo)) ? "undone" : "open" }];
  });
}

const RECORD_KIND: Record<TmKind, EntryKind> = { file: "file", vault: "file", memory: "memory", link: "memory", setting: "setting", branch: "code" };
/** Time-machine records an Activity line doesn't already show (records made outside CORE, and every undo/redo). */
export function recordEntries(recs: TmRecord[], items: ActItem[], tz = TM_TZ): Entry[] {
  const shown = new Set(items.flatMap((x) => (x.undo?.kind === "tm" && !x.undid ? [x.undo.id] : [])));
  const undone = undoneIds(recs);
  return recs.filter((r) => !shown.has(r.id)).map((r) => {
    const day = dayOf(r.at, tz);
    return { id: `tm:${r.id}`, at: r.at, day, kind: RECORD_KIND[kindOf(r)], what: r.title, ...(r.why ? { why: r.why } : {}), undo: { tm: r.id, redo: isUndoRecord(r) }, state: undone.has(r.id) ? "undone" : "open" } as Entry;
  });
}

/** Last guard before anything leaves the server: journal entries carry nothing but "Journal entry" and the day. */
export function redact(e: Entry): Entry {
  return e.kind === "journal" || e.state === "private" ? privateEntry(e.id, e.at, e.day) : e;
}

/** Every source → one day's entries, newest first, redacted. */
export function timeline(day: string, parts: { items: ActItem[]; recs: TmRecord[]; ledger: LedgerRow[] }, tz = TM_TZ): Entry[] {
  return [...activityEntries(parts.items, parts.recs, tz), ...recordEntries(parts.recs, parts.items, tz), ...ledgerEntries(parts.ledger, tz)]
    .filter((e) => e.day === day).map(redact).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

// ---- the shared progress card ----
const W = {
  en: { undo: "Undo", redo: "Undo the undo", undone: "Undone", sent: "Can't be undone: it was sent", done: "Done", journal: "Journal entry", noUndo: "No undo for this one" },
  et: { undo: "Võta tagasi", redo: "Tühista tagasivõtmine", undone: "Tagasi võetud", sent: "Ei saa tagasi võtta: see on saadetud", done: "Tehtud", journal: "Päeviku sissekanne", noUndo: "Seda ei saa tagasi võtta" },
} as const;
export const tmWords = (lang: Lang) => W[lang];
const time = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** One entry → the shared "Working on it" card (finished work: no steps). The button is Undo / Undo the undo, or none. */
export function entryCard(e: Entry, lang: Lang, tz = TM_TZ): Progress {
  const w = W[lang];
  if (e.kind === "journal") return { id: e.id, title: `${w.journal} · ${e.day}`, phase: "done", steps: [], now: null, leftMin: null, result: null, action: null, at: e.at };
  const status = e.state === "sent" ? w.sent : e.state === "undone" ? w.undone : e.state === "open" ? "" : e.undo ? "" : w.noUndo;
  const result = [time(e.at, tz), e.why, status].filter(Boolean).join(" · ");
  const redo = !!e.undo && "tm" in e.undo && e.undo.redo;
  const action = e.state === "open" && e.undo ? { kind: "undo" as const, label: redo ? w.redo : w.undo, open: "" } : null;
  return { id: e.id, title: e.what, phase: "done", steps: [], now: null, leftMin: null, result: { text: result }, action, at: e.at };
}
