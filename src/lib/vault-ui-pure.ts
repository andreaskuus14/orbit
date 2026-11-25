// VAULT planet UI rules (no DOM, no node imports): type groups and the storage map, the one search (names + words inside),
// sorting, highlighted search snippets, short local dates, the status line, which actions a file has, the jobs as Progress
// cards, and the TIME MACHINE changes that touched VAULT (ORBIT-made files, sandbox_save results, renames) with their Undo.
// UI: components/VaultPlanet.tsx + VaultFileSheet.tsx. Tests: tests/vault-ui.test.ts.
import { memoryType, type Kind } from "./vault-pure.ts";
import type { Progress } from "./progress-pure.ts";
import type { TmRecord } from "./time-machine-pure.ts";
import type { Lang } from "./i18n-core-pure.ts";
/** Same rule as offline-tools-pure isJournalName (kept here so the browser bundle doesn't pull node-only modules; the test checks they agree). */
export const isJournalName = (s: unknown) => typeof s === "string" && /journal|p[äa]evik|diary|life\.json/i.test(s);

export type Group = "docs" | "images" | "media" | "other";
export const GROUPS: readonly Group[] = ["docs", "images", "media", "other"];
export const groupOf = (k: Kind): Group => (k === "pdf" || k === "text" || k === "doc" ? "docs" : k === "image" ? "images" : k === "video" || k === "audio" ? "media" : "other");

/** Bytes and counts per group, in a fixed order; share sums to 1 (0 for an empty vault). */
export function storageMap(files: { size: number; type: Kind }[]): { group: Group; bytes: number; count: number; share: number }[] {
  const total = files.reduce((a, f) => a + f.size, 0);
  return GROUPS.map((group) => {
    const own = files.filter((f) => groupOf(f.type) === group);
    const bytes = own.reduce((a, f) => a + f.size, 0);
    return { group, bytes, count: own.length, share: total ? bytes / total : 0 };
  });
}

export type Sort = "newest" | "name" | "size";
export type Listed = { name: string; size: number; mtime: number; type: Kind };
/** The one search: a name match, or a word inside (hits from the server's content search). Then the group chip, then the sort. */
export function filterFiles<T extends Listed>(files: T[], o: { q: string; group: Group | "all"; sort: Sort; hits: Record<string, string> | null }): T[] {
  const needle = o.q.trim().toLowerCase();
  const list = files.filter((f) => (o.group === "all" || groupOf(f.type) === o.group)
    && (!needle || f.name.toLowerCase().includes(needle) || (o.hits !== null && f.name in o.hits)));
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  return list.sort((a, b) => (o.sort === "name" ? byName(a, b) : o.sort === "size" ? b.size - a.size || byName(a, b) : b.mtime - a.mtime || byName(a, b)));
}
/** Words inside are searched from 2 characters (one letter would match nearly every file). */
export const searchesInside = (q: string) => q.trim().length >= 2;

/** The snippet starting a little before its first match, so the match is seen in a one-line row ("…" marks the cut). */
export function around(text: string, q: string, before = 32): string {
  const at = text.toLowerCase().indexOf(q.trim().toLowerCase());
  if (!q.trim() || at <= before) return text;
  const cut = text.lastIndexOf(" ", at - before);
  return `…${text.slice(cut > 0 && cut > at - before - 16 ? cut + 1 : at - before).replace(/^[…\s]+/, "")}`;
}

/** A snippet split into plain and matched parts (case-insensitive, every occurrence), for <mark>. */
export function highlight(text: string, q: string): { text: string; hit: boolean }[] {
  const needle = q.trim();
  if (!needle || !text) return text ? [{ text, hit: false }] : [];
  const out: { text: string; hit: boolean }[] = [];
  const low = text.toLowerCase(), n = needle.toLowerCase();
  let i = 0;
  for (let at = low.indexOf(n); at !== -1; at = low.indexOf(n, at + n.length)) {
    if (at > i) out.push({ text: text.slice(i, at), hit: false });
    out.push({ text: text.slice(at, at + n.length), hit: true });
    i = at + n.length;
  }
  if (i < text.length) out.push({ text: text.slice(i), hit: false });
  return out;
}

const LOCALE: Record<Lang, string> = { en: "en-GB", et: "et-EE" };
const W = {
  en: { today: "Today", yesterday: "Yesterday", files: (n: number) => `${n} file${n === 1 ? "" : "s"}`, of: "of", noCloud: (n: number) => `${n} without a cloud copy`, cloudOff: "cloud not reachable", empty: "No files yet" },
  et: { today: "Täna", yesterday: "Eile", files: (n: number) => `${n} fail${n === 1 ? "" : "i"}`, of: "/", noCloud: (n: number) => `${n} pilvekoopiata`, cloudOff: "pilv pole kättesaadav", empty: "Faile veel pole" },
} as const;

/** "Today 08:25", "Yesterday 18:07", "12 Nov", "12 Nov 2025" (et: "Täna 08:25", "12. nov"), Europe/Tallinn by default. */
export function fileDate(ms: number, lang: Lang, now = Date.now(), timeZone = "Europe/Tallinn"): string {
  const day = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
  const time = new Intl.DateTimeFormat(LOCALE[lang], { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
  if (day(ms) === day(now)) return `${W[lang].today} ${time}`;
  if (day(ms) === day(now - 86_400_000)) return `${W[lang].yesterday} ${time}`;
  const sameYear = day(ms).slice(0, 4) === day(now).slice(0, 4);
  return new Intl.DateTimeFormat(LOCALE[lang], { timeZone, day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(new Date(ms)).replace(/\.$/, "");
}

/** 1.2 MB / 820 KB / 90 B (1024-based, like VAULT's limits: 40 MB a file, 5 GB in all) with the locale's decimal sign. */
export function size(bytes: number, lang: Lang): string {
  const K = 1024;
  const [v, u] = bytes >= K ** 3 ? [bytes / K ** 3, "GB"] : bytes >= K ** 2 ? [bytes / K ** 2, "MB"] : bytes >= K ? [bytes / K, "KB"] : [bytes, "B"];
  const s = u === "B" || v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "");
  return `${lang === "et" ? s.replace(".", ",") : s} ${u}`;
}

/** Header line (≤ 40 characters where it can be): count · used of the limit, or the one thing that is off. */
export function statusLine(o: { count: number; bytes: number; limit: number; noCloud: number; cloudError: boolean }, lang: Lang): string {
  const w = W[lang];
  if (!o.count) return w.empty;
  const head = `${w.files(o.count)} · ${size(o.bytes, lang)} ${w.of} ${size(o.limit, lang)}`;
  if (o.cloudError) return `${w.files(o.count)} · ${w.cloudOff}`;
  if (o.noCloud) return `${w.files(o.count)} · ${w.noCloud(o.noCloud)}`;
  return head;
}

export type Preview = "image" | "video" | "audio" | "text" | "doctext" | "none";
/** What a file can do in its sheet. ask = Ask ORBIT about it (never for a journal-looking name: its text never goes to a model). */
export function fileActions(f: { name: string; type: Kind; size: number }, memoryMax: number) {
  const n = f.name;
  const journal = isJournalName(n);
  return {
    preview: (f.type === "image" || f.type === "video" || f.type === "audio" || f.type === "text" ? f.type : f.type === "pdf" || /\.docx$/i.test(n) ? "doctext" : "none") as Preview,
    ask: !journal && (f.type === "text" || f.type === "pdf" || f.type === "doc"),
    fields: /\.(pdf|png|jpe?g)$/i.test(n), // invoice / order fields, read on this PC
    skill: !journal && /\.(pdf|docx?|txt|md|epub)$/i.test(n),
    memory: !journal && memoryType(n) !== null && f.size <= memoryMax,
    markdown: /\.(pdf|docx|pptx|xlsx|html?)$/i.test(n),
    compare: f.type === "text",
    podcast: !journal && /\.(pdf|docx?|txt|md)$/i.test(n),
  };
}

/** One local VAULT job (upload, sync, podcast, notes, fields, download) as the shared Progress card. */
export function jobCard(j: { id: string; title: string; done?: number; total?: number; now?: string | null; at: number; failed?: string }): Progress {
  const total = j.total ?? 0, done = Math.min(j.done ?? 0, total);
  return {
    id: j.id, title: j.title, phase: j.failed ? "failed" : "working",
    steps: Array.from({ length: total }, (_, i) => ({ label: String(i + 1), state: i < done ? "done" : i === done ? "now" : "next" })),
    now: j.failed ? null : j.now ?? null, leftMin: null, result: j.failed ? { text: j.failed } : null, action: null, at: new Date(j.at).toISOString(),
  };
}

/** A TIME MACHINE change that touched VAULT: what ORBIT made or moved there, with its Undo while it is still open. */
export type VaultChange = { id: string; at: string; title: string; why: string; name: string; open: boolean; redo: boolean; made: boolean };
const NAME = /"([^"]{1,300})"/;
/** VAULT changes from the time-machine records, newest first, within `days`. Journal-looking names never show (no text, no title). */
export function vaultChanges(recs: TmRecord[], now: number, days = 7, max = 20): VaultChange[] {
  const undone = new Set(recs.flatMap((r) => (r.undid ? [r.undid] : [])));
  const from = now - days * 86_400_000;
  return recs.filter((r) => r.changes.length > 0 && r.changes.every((c) => c.t === "vault") && Date.parse(r.at) >= from)
    .map((r): VaultChange | null => {
      const c = r.changes[0] as Extract<TmRecord["changes"][number], { t: "vault" }>;
      const name = (c.after && "name" in c.after ? c.after.name : c.before && "name" in c.before ? c.before.name : null) ?? r.title.match(NAME)?.[1] ?? "";
      if (!name || isJournalName(name) || isJournalName(r.title)) return null;
      const redo = /^Undone: /.test(r.title);
      return { id: r.id, at: r.at, title: r.title.replace(/^VAULT:\s*/, ""), why: r.why ?? "", name, open: !undone.has(r.id), redo, made: !redo && c.before === null && !!c.after && !("trash" in c.after) };
    })
    .filter((x): x is VaultChange => x !== null)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, max);
}

/** Server error text → what he reads. Raw developer text (commands, env names, stack lines) becomes a plain sentence. */
export function plainError(raw: string, fallback: string, words: { localOff: string; cloudDown?: string }): string {
  const s = raw.trim();
  if (!s) return fallback;
  if (words.cloudDown && /cloud unavailable|fetch failed|cloud download failed/i.test(s)) return words.cloudDown;
  if (/local model is off|ollama|setup\.ps1|not running|ECONNREFUSED|older server\.py/i.test(s)) return words.localOff;
  if (/\b[A-Z_]{4,}=|\\tools\\|\.ps1|\bat\s+\S+\s*\(|Error:\s*\w+Error/.test(s)) return fallback;
  return s.length > 200 ? `${s.slice(0, 197)}…` : s;
}
