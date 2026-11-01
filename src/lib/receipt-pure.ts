// Receipts: "the tool ran" is not "the result is correct". Every finished CORE turn that changed something, agent task and
// background job gets one: what was asked, the acceptance condition derived from the ask, what was verified (read back / checked)
// vs only claimed, what failed or needs a manual check, and links. Pure; tests in tests/receipt.test.ts.
// Wired in: core.ts (last trace step .receipt), core-turn.ts (Activity line, background task trace), activity-pure taskItems,
// needs-you-pure doneDigest, DeliverableCards ReceiptChip.
import { EFFECTS } from "./approval-pure.ts";
import type { ActionResult, WriteEvidence } from "./completion-pure.ts";
import type { Lang } from "./i18n-pure.ts";

/** Never "done" without a passed check: verified = the acceptance check passed; partly = some of it; unverified = ran, not checked. */
export type ReceiptStatus = "verified" | "partly" | "unverified" | "failed";
export type Receipt = { asked: string; accept: string; status: ReceiptStatus; verified: string[]; claimed: string[]; failed: string[]; links: string[] };
type Tool = { tool: string; input: Readonly<Record<string, unknown>>; output: string; evidence: readonly WriteEvidence[] };

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, üks: 1, kaks: 2, kolm: 3, neli: 4, viis: 5, kuus: 6, seitse: 7, kaheksa: 8, üheksa: 9, kümme: 10 };
const COUNTED = /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|üks|kaks|kolm|neli|viis|kuus|seitse|kaheksa|üheksa|kümme)\s+(?:new\s+|more\s+|uut?\s+)?(leads?|prospects?|liidi?d?|memor(?:y|ies)|notes?|files?|pages?)\b/i;
const SITE = /\b(?:build|make|create|redesign|rewrite)\b[\s\S]{0,80}\b(?:site|website|web ?page|landing|portfolio|app|game)\b|\b(?:ehita|loo|tee)\b[\s\S]{0,60}(?:veebileh|lehe|äpp|mäng)/i;
const OUTWARD = /^(?:schedule_approved)$/; // started an upload/publish: only the platform can confirm it, later
const isWrite = (tool: string) => tool in EFFECTS && EFFECTS[tool] !== "read";
const leadsAdded = (out: string) => [...out.matchAll(/^added "([^"\n]+)" \(id /gm)].map((m) => m[1]);
const checkPassed = (out: string) => /\nCheck: /.test(out) && !/Problems the headless check found|Still open|^Error:/m.test(out);
const fileLink = (e: WriteEvidence) => `/api/workspace?ws=${encodeURIComponent(e.id)}&file=${encodeURIComponent(e.path!)}&open=1`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** What would prove the ask is met: a count ("5 leads" → 5 lead_create results), a site (files + site check), else every write read back. */
export function acceptanceOf(question: string): { kind: "count"; noun: "lead" | "memory" | "file"; n: number; text: string } | { kind: "site"; text: string } | { kind: "writes"; text: string } {
  const m = COUNTED.exec(question);
  if (m) {
    const n = Number(m[1]) || NUM[m[1].toLowerCase()] || 0, w = m[2].toLowerCase();
    const noun = /^(?:lead|prosp|liid)/.test(w) ? "lead" : /^(?:memor|note)/.test(w) ? "memory" : "file";
    if (n > 0) return { kind: "count", noun, n, text: `${plural(n, noun === "memory" ? "memory" : noun)} saved`.replace("memorys", "memories") };
  }
  if (SITE.test(question)) return { kind: "site", text: "files written and the site check passed" };
  return { kind: "writes", text: "every change read back" };
}

/** A CORE turn's receipt from its tool results; null when nothing was changed (reads and answers only). */
export function coreReceipt(question: string, tools: readonly Tool[]): Receipt | null {
  const writes = tools.filter((t) => isWrite(t.tool));
  if (!writes.length) return null;
  const acc = acceptanceOf(question), verified: string[] = [], claimed: string[] = [], failed: string[] = [], links: string[] = [];
  let leads = 0, mems = 0, siteOk: boolean | null = null;
  const files = new Map<string, WriteEvidence>();
  for (const t of writes) {
    if (t.output.startsWith("Error:")) { failed.push(`${t.tool}: ${t.output.slice(7, 120).trim()}`); continue; }
    if (t.tool === "lead_create") { const a = leadsAdded(t.output); leads += a.length; if (a.length) verified.push(`${plural(a.length, "lead")} stored (${a.slice(0, 5).join(", ")})`); continue; }
    if (t.tool === "ws_write") {
      t.evidence.filter((e) => e.kind === "file" && e.path).forEach((e) => files.set(`${e.id}/${e.path}`, e));
      if (/\nCheck: /.test(t.output)) siteOk = checkPassed(t.output); // the last check counts (after fix rounds)
      continue;
    }
    if (t.tool === "save_memory" && t.evidence.some((e) => e.kind === "memory")) { mems++; verified.push("memory saved and read back"); continue; }
    if (OUTWARD.test(t.tool)) { claimed.push(`${t.tool}: started; the platform hasn't confirmed it yet`); continue; }
    if (t.evidence.length) verified.push(`${t.tool}: read back`); else if (/^Done:/.test(t.output)) claimed.push(`${t.tool}: done, not read back`);
  }
  if (files.size) {
    verified.push(`${plural(files.size, "file")} written and read back`);
    const all = [...files.values()], idx = all.find((e) => e.path === "index.html") ?? all[0];
    links.push(fileLink(idx));
    if (siteOk === true) verified.push("site check passed");
    else if (siteOk === false) failed.push("site check found problems still open");
    else if (acc.kind === "site") claimed.push("site not checked (no check ran)");
  }
  const got = acc.kind === "count" ? (acc.noun === "lead" ? leads : acc.noun === "memory" ? mems : files.size) : 0;
  const met = acc.kind === "count" ? got >= acc.n : acc.kind === "site" ? files.size > 0 && siteOk === true : !failed.length && !claimed.length && verified.length > 0;
  const accept = acc.kind === "count" ? `${acc.text} (got ${got})` : acc.text;
  return { asked: question.replace(/\s+/g, " ").trim().slice(0, 160), accept, status: settle(met, verified.length > 0, claimed.length > 0, failed.length > 0), verified, claimed, failed, links };
}

function settle(met: boolean, checked: boolean, ran: boolean, failures: boolean): ReceiptStatus {
  if (met && !failures) return "verified";
  if (checked) return "partly"; // something passed its check, but not the whole acceptance (or something failed)
  if (ran) return failures ? "partly" : "unverified";
  return failures ? "failed" : "unverified";
}

type TaskIn = { request?: string | null; title: string; status: string; error?: string | null; pending?: (ActionResult & { tool?: string })[] | null };
/** A finished agent task / background job: approved actions with read-back evidence are verified; an attempt without a receipt
 *  is "check manually", never retried. Null while it is still queued, running or waiting. */
export function taskReceipt(t: TaskIn): Receipt | null {
  if (!["done", "failed", "cancelled"].includes(t.status)) return null;
  const verified: string[] = [], claimed: string[] = [], failed: string[] = [], links: string[] = [];
  for (const a of t.pending ?? []) {
    const name = a.tool ?? "action";
    if (a.status === "approved" && a.evidence?.length) {
      verified.push(`${name}: read back${a.evidence[0].check ? ` (${a.evidence[0].check})` : ""}`);
      const f = a.evidence.find((e) => e.kind === "file" && e.path);
      if (f) links.push(fileLink(f));
    } else if (a.status === "approved") claimed.push(`${name}: ran, not read back`);
    else if (a.status === "attempting" || a.status === "uncertain") failed.push(`Check manually: ${name} may or may not have happened`);
    else if (a.status === "failed") failed.push(`${name} failed${a.note ? `: ${a.note.slice(0, 100)}` : ""}`);
  }
  if (t.status === "failed" && !failed.length) failed.push((t.error ?? "Failed").slice(0, 160));
  if (t.status === "done" && !(t.pending ?? []).length) claimed.push("answer only: nothing to check");
  const acts = (t.pending ?? []).filter((a) => a.status !== "rejected" && a.status !== "pending");
  const met = t.status === "done" && acts.length > 0 && acts.every((a) => a.status === "approved" && a.evidence?.length);
  const status = settle(met, verified.length > 0, claimed.length > 0, failed.length > 0 || t.status !== "done");
  return { asked: (t.request || t.title).replace(/\s+/g, " ").trim().slice(0, 160), accept: "every approved action read back", status, verified, claimed, failed, links };
}

const WORD = {
  en: { verified: "Verified", partly: "Partly done", unverified: "Not verified", failed: "Failed", need: "need", ok: "checked", claimed: "not checked", bad: "failed" },
  et: { verified: "Kontrollitud", partly: "Osaliselt tehtud", unverified: "Kontrollimata", failed: "Ebaõnnestus", need: "vaja", ok: "kontrollitud", claimed: "kontrollimata", bad: "ebaõnnestus" },
};
/** One compact line: "Partly done · need 5 leads saved (got 3) · 1 checked · 1 failed". */
export function receiptLine(r: Receipt, lang: Lang = "en"): string {
  const w = WORD[lang];
  return [w[r.status], `${w.need} ${r.accept}`, r.verified.length && `${r.verified.length} ${w.ok}`, r.claimed.length && `${r.claimed.length} ${w.claimed}`, r.failed.length && `${r.failed.length} ${w.bad}`]
    .filter(Boolean).join(" · ");
}

/** Untrusted stored receipt (trace JSON) → a valid one, or null. */
export function cleanReceipt(x: unknown): Receipt | null {
  const r = x as Receipt | null;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string").slice(0, 20).map((s) => s.slice(0, 300)) : []);
  if (!r || typeof r !== "object" || !["verified", "partly", "unverified", "failed"].includes(r.status)) return null;
  return { asked: String(r.asked ?? "").slice(0, 160), accept: String(r.accept ?? "").slice(0, 160), status: r.status, verified: list(r.verified), claimed: list(r.claimed), failed: list(r.failed),
    links: list(r.links).filter((l) => l.startsWith("/api/workspace?")) };
}

/** A task row's receipt: the one a background CORE turn stored in its trace, else derived from its actions. */
export function rowReceipt(t: TaskIn & { trace?: { step: string; receipt?: unknown }[] | null }): Receipt | null {
  return t.status === "done" || t.status === "failed" ? cleanReceipt(t.trace?.find((s) => s?.step === "receipt")?.receipt) ?? taskReceipt(t) : taskReceipt(t);
}
