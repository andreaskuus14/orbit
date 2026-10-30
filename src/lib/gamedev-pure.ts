// GAME DEV workflow rules (DEV01-03, DEV05, DEV08): per-game project contract, labelled test evidence, asset checks and
// release packages. Pure; stored inside the dev world (validated by devworld-pure's parse via the clean* helpers here).
import type { Bug, DevWorld, Game, Trail } from "./devworld-pure.ts";

/* ---------- shared validation ---------- */
class Bad extends Error {}
export const isBad = (e: unknown): e is Error => e instanceof Bad;
export const no = (m: string): never => { throw new Bad(m); };
export const rec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ID = /^[\w-]{1,64}$/;
const id = (v: unknown, at: string) => (typeof v === "string" && ID.test(v) ? v : no(`${at}: invalid id`));
const one = <T extends string>(v: unknown, list: readonly T[], at: string): T => (list.includes(v as T) ? (v as T) : no(`${at} must be one of ${list.join(", ")}`));
export const when = (v: unknown, at: string) => { const t = typeof v === "string" ? Date.parse(v) : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : no(`${at} must be a date`); };

/* ---------- DEV01 project contract ---------- */
export const CONTRACT_FIELDS = ["engine", "repo", "controls", "art", "build", "milestone"] as const;
export type Contract = Partial<Record<(typeof CONTRACT_FIELDS)[number], string>>;

export function cleanContract(v: unknown, at: string): Contract | undefined {
  if (v == null) return undefined;
  if (!rec(v)) return no(`${at} contract is invalid`);
  const c: Contract = {};
  for (const k of CONTRACT_FIELDS) { const s = str(v[k], 200); if (s) c[k] = s; }
  return Object.keys(c).length ? c : undefined;
}

/** The one game's contract as tool context. Only `game` is read, so another game's details can never leak in. */
export function contractBrief(game: Pick<Game, "name" | "platform" | "stage"> & { contract?: Contract }): string {
  const c = game.contract ?? {};
  const parts = [`Game: ${game.name}`, `platform: ${game.platform}`, `stage: ${game.stage}`, ...CONTRACT_FIELDS.filter((k) => c[k]).map((k) => `${k}: ${c[k]}`)];
  return parts.join(" · ").replace(/[<>]/g, "").slice(0, 1200);
}
/** Contract fields still empty: shown so the owner knows what tools are guessing. */
export const contractGaps = (c: Contract | undefined) => CONTRACT_FIELDS.filter((k) => !c?.[k]);

/* ---------- DEV03 labelled test evidence ---------- */
/** static = read the code/notes; simulated = AI persona critique; runtime = an automated run that executed; player = real people. */
export const EVIDENCE_KINDS = ["static", "simulated", "runtime", "player"] as const;
export const OUTCOMES = ["pass", "fail", "notes", "not_run"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type Outcome = (typeof OUTCOMES)[number];
export type Evidence = { id: string; game: string; bugId?: string; kind: EvidenceKind; outcome: Outcome; env: string; build: string; actions: string; summary: string; at: string };

const RETENTION = /\b(retention|retain(ed|s)?|d1|d7|d30|come back|returning players?|churn)\b/i;
/** The rules every saved result obeys: nothing that did not execute is "passed"; a simulated or static check cannot pass
 *  (it can only find problems or give notes); an AI persona never claims retention. */
export function normalizeEvidence(e: Evidence): Evidence {
  let outcome = e.outcome;
  const executed = (e.kind === "runtime" || e.kind === "player") && !!e.actions.trim() && !!e.build.trim();
  if (outcome === "pass" && !executed) outcome = e.kind === "runtime" || e.kind === "player" ? "not_run" : "notes";
  const summary = e.kind === "simulated" && RETENTION.test(e.summary) ? `${e.summary} [Simulated: not a retention measurement.]` : e.summary;
  return { ...e, outcome, summary };
}

export function cleanEvidence(v: unknown, at: string, games: Set<string>, bugs: Set<string>): Evidence | null {
  if (!rec(v)) return no(`${at} is invalid`);
  if (!games.has(v.game as string)) return null; // its game was deleted: drop it
  const e: Evidence = {
    id: id(v.id, at), game: v.game as string, kind: one(v.kind, EVIDENCE_KINDS, `${at} kind`), outcome: one(v.outcome, OUTCOMES, `${at} outcome`),
    env: str(v.env, 120), build: str(v.build, 80), actions: str(v.actions, 1000), summary: str(v.summary, 2000) || no(`${at} summary is required`), at: when(v.at, `${at} time`),
  };
  if (typeof v.bugId === "string" && bugs.has(v.bugId)) e.bugId = v.bugId;
  return normalizeEvidence(e);
}

/* ---------- DEV02 backlog item → reviewable result ---------- */
export const WORK_STEPS = ["evidence", "change", "checks", "review"] as const;
export type WorkStep = (typeof WORK_STEPS)[number];
/** Where a backlog item is: reproduction evidence → proposed change (trail fix or Goal) → checks after the change → reviewed result. */
export function workSteps(bug: Pick<Bug, "id" | "goalId">, trail: Trail | undefined, evidence: Evidence[]): Record<WorkStep, boolean> {
  const mine = evidence.filter((e) => e.bugId === bug.id);
  const fixAt = trail?.fix?.at ?? "";
  const change = !!trail?.fix || !!bug.goalId;
  return {
    evidence: mine.some((e) => !fixAt || e.at <= fixAt),
    change,
    checks: change && mine.some((e) => e.outcome !== "not_run" && (!fixAt || e.at > fixAt)),
    review: trail?.fix?.state === "reviewed",
  };
}
export const nextStep = (s: Record<WorkStep, boolean>): WorkStep | null => WORK_STEPS.find((k) => !s[k]) ?? null;

/* ---------- DEV05 assets ---------- */
export const ASSET_FORMATS = ["png", "jpg", "webp", "svg", "fbx", "obj", "glb", "rbxm", "mp3", "ogg", "wav", "other"] as const;
export type Asset = { id: string; game: string; name: string; width?: number; height?: number; format: (typeof ASSET_FORMATS)[number];
  source: string; license: string; generation?: string; use: string; preview: boolean };
const IMAGE = new Set(["png", "jpg", "webp"]);
const ROBLOX_MAX = 1024; // Roblox downscales image uploads above 1024 px

/** Import checks; an asset is production-ready only with none. A preview (draft/watermarked/low-res placeholder) never is. */
export function assetIssues(a: Asset, platform: Game["platform"]): string[] {
  const out: string[] = [];
  if (a.preview) out.push("preview");
  if (!a.license.trim()) out.push("license");
  if (!a.source.trim()) out.push("source");
  if (!a.use.trim()) out.push("use");
  if (IMAGE.has(a.format)) {
    if (!a.width || !a.height) out.push("dimensions");
    else if (platform === "roblox" && Math.max(a.width, a.height) > ROBLOX_MAX) out.push("tooLarge");
  }
  if (a.format === "other") out.push("format");
  if (/\bnc\b|non-?commercial|editorial|unknown/i.test(a.license)) out.push("licenseLimited");
  return out;
}
export const productionReady = (a: Asset, platform: Game["platform"]) => assetIssues(a, platform).length === 0;

const dim = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 && (v as number) <= 16384 ? (v as number) : undefined);
export function cleanAsset(v: unknown, at: string, games: Set<string>): Asset | null {
  if (!rec(v)) return no(`${at} is invalid`);
  if (!games.has(v.game as string)) return null;
  const a: Asset = { id: id(v.id, at), game: v.game as string, name: str(v.name, 80) || no(`${at} name is required`), format: one(v.format, ASSET_FORMATS, `${at} format`),
    source: str(v.source, 200), license: str(v.license, 80), use: str(v.use, 200), preview: v.preview !== false };
  const w = dim(v.width), h = dim(v.height), g = str(v.generation, 500);
  if (w) a.width = w; if (h) a.height = h; if (g) a.generation = g;
  return a;
}

/* ---------- DEV08 release package ---------- */
export type Release = { id: string; game: string; build: string; changes: string; issues: string; rollback: string; checklist: { text: string; done: boolean }[]; evidenceIds: string[]; at: string };
export const DEFAULT_CHECKLIST = ["Tested on the target platform", "Save data migrates", "No crash bugs open", "Store page and thumbnail ready"];

/** What blocks the package; empty = ready for the owner to publish himself (ORBIT never publishes). */
export function releaseGaps(r: Release, world: Pick<DevWorld, "bugs"> & { evidence?: Evidence[] }): string[] {
  const out: string[] = [];
  if (!r.build.trim()) out.push("build");
  if (!r.changes.trim()) out.push("changes");
  if (!r.rollback.trim()) out.push("rollback");
  if (r.checklist.some((c) => !c.done)) out.push("checklist");
  const ev = (world.evidence ?? []).filter((e) => r.evidenceIds.includes(e.id) && e.game === r.game);
  if (!ev.some((e) => (e.kind === "runtime" || e.kind === "player") && e.outcome === "pass" && e.build === r.build)) out.push("evidence");
  if (world.bugs.some((b) => b.game === r.game && b.severity === "crash" && (b.status === "open" || b.status === "fixing"))) out.push("crash");
  return out;
}

export function cleanRelease(v: unknown, at: string, games: Set<string>, evidence: Set<string>): Release | null {
  if (!rec(v)) return no(`${at} is invalid`);
  if (!games.has(v.game as string)) return null;
  return {
    id: id(v.id, at), game: v.game as string, build: str(v.build, 80), changes: str(v.changes, 2000), issues: str(v.issues, 2000), rollback: str(v.rollback, 200), at: when(v.at, `${at} time`),
    checklist: (Array.isArray(v.checklist) ? v.checklist : []).slice(0, 20).flatMap((c) => (rec(c) && str(c.text, 120) ? [{ text: str(c.text, 120), done: c.done === true }] : [])),
    evidenceIds: (Array.isArray(v.evidenceIds) ? v.evidenceIds : []).filter((x): x is string => typeof x === "string" && evidence.has(x)).slice(0, 20),
  };
}
