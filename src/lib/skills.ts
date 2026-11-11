import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { askClaude, recordUsage, FAST_MODEL } from "./claude";
import { stopAllOn } from "./stop-all";
import { usageHold } from "./usage-meter";
import { DRAFT_SYSTEM, PROPOSALS_KEPT, PROPOSED_MAX, SKILLS_MAX, addVersion, currentVersion, detectRepeats, draftFromCandidate, draftPrompt, findSkill, isKnown,
  parseModelDraft, parseRunSkill, parseStore, rollback, skillPrompt, uniqueName, usagesFromMessages, validateDraft, type Skill, type Store,
  cleanCard, logRun, pickVersion, promote, recordEval, setCard, splitVersion } from "./skills-pure";

// Skill forge I/O (logic: skills-pure.ts). State: <ORBIT data dir>/skills.json (local, single owner, like recipes).
// A scan reads his own CORE turns (messages + traces); at most one fast-model call per scan names the newest proposal.

const file = () => path.join(orbitDataDir(), "skills.json");
const SCAN_EVERY = 6 * 3_600_000, LOOKBACK = 90 * 86_400_000;
const g = globalThis as unknown as { __orbitSkills?: Promise<unknown> };

async function load(): Promise<Store> {
  const s = parseStore(await readFile(file(), "utf8").catch((e) => { if (e.code === "ENOENT") return ""; throw e; }));
  if (!s) throw new Error("skills.json is unreadable; fix or move it aside (nothing was overwritten).");
  return s;
}
/** Read-modify-write, one at a time, saved atomically. */
function update<T>(fn: (s: Store) => T): Promise<T> {
  const p = (g.__orbitSkills ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await load();
    const out = fn(s);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s, null, 1));
    await rename(file() + ".tmp", file());
    return out;
  });
  g.__orbitSkills = p;
  return p;
}

export async function skillsView() {
  const s = await load();
  return { skills: s.skills, proposals: s.proposals.filter((p) => p.status === "proposed"), scannedAt: s.scannedAt ?? null };
}

/** Look for repeated multi-step CORE turns and propose skills (at most every 6 h). Returns how many are newly proposed. */
export async function scanSkills(sb: SupabaseClient, userId: string, now = Date.now()): Promise<number> {
  const st = await load();
  if (st.scannedAt && now - Date.parse(st.scannedAt) < SCAN_EVERY) return 0;
  const { data, error } = await sb.from("messages").select("id, conversation_id, role, content, trace, created_at").eq("user_id", userId)
    .gte("created_at", new Date(now - LOOKBACK).toISOString()).order("created_at", { ascending: false }).limit(3000);
  if (error) throw error;
  data?.reverse(); // newest 3000 in time order: ascending + limit dropped the newest turns once a busy week passed the cap
  const { MODULE_PRIVATE } = await import("./core-modules"); // LIFE/journal-touching turns are never mined or shown to a model
  const fresh = detectRepeats(usagesFromMessages(data ?? []), { exclude: MODULE_PRIVATE }).filter((c) => !isKnown(c, st.proposals));
  const room = Math.max(0, PROPOSED_MAX - st.proposals.filter((p) => p.status === "proposed").length);
  const picks = fresh.slice(0, room);
  const drafts = picks.map(draftFromCandidate);
  if (picks.length && !stopAllOn() && !usageHold()) { // the one model call: name the strongest new proposal; the plain draft stands on any failure
    try {
      const r = await askClaude(draftPrompt(picks[0]), DRAFT_SYSTEM, { lane: "background", model: FAST_MODEL, purpose: "skills.draft", timeoutMs: 60_000 });
      void recordUsage(sb, userId, "skills.draft", r, FAST_MODEL);
      drafts[0] = parseModelDraft(r.text, drafts[0]);
    } catch (e) { console.warn("[skills] draft call failed:", e instanceof Error ? e.message : e); }
  }
  const at = new Date(now).toISOString();
  return update((s) => {
    s.scannedAt = at;
    const taken = [...s.skills.map((k) => currentVersion(k).name), ...s.proposals.filter((p) => p.status === "proposed").map((p) => p.name)];
    picks.forEach((c, i) => {
      if (isKnown(c, s.proposals)) return;
      const name = uniqueName(drafts[i].name, taken);
      taken.push(name);
      s.proposals.unshift({ ...drafts[i], name, id: randomUUID(), support: c.evidence.length, evidence: c.evidence, at, status: "proposed" });
    });
    s.proposals = s.proposals.slice(0, PROPOSALS_KEPT); // decided ones stay (until the cap) so the same repeat isn't proposed again
    return picks.length;
  });
}

/** Keep (optionally with his edits) → a v1 skill; dismiss → never proposed again. */
export function decideProposal(id: string, decision: "keep" | "dismiss", edits?: unknown): Promise<string | null> {
  return update((s) => {
    const p = s.proposals.find((x) => x.id === id && x.status === "proposed");
    if (!p) return "Proposal not found";
    if (decision === "dismiss") { p.status = "dismissed"; return null; }
    const d = validateDraft(edits && typeof edits === "object" ? { ...p, ...edits } : p);
    if (typeof d === "string") return d;
    if (s.skills.length >= SKILLS_MAX) return `At most ${SKILLS_MAX} skills: delete one first`;
    if (s.skills.some((k) => currentVersion(k).name === d.name)) return `A skill named "${d.name}" already exists`;
    const at = new Date().toISOString();
    s.skills.unshift({ id: randomUUID(), current: 1, versions: [{ ...d, v: 1, at, note: "kept" }], created_at: at });
    p.status = "kept";
    return null;
  });
}

/** His edit → a new candidate version (AGT04): the current one keeps running until he promotes the candidate. */
export function editSkill(id: string, body: unknown): Promise<string | null> {
  return update((s) => {
    const i = s.skills.findIndex((k) => k.id === id);
    if (i < 0) return "Skill not found";
    const d = validateDraft(body);
    if (typeof d === "string") return d;
    if (s.skills.some((k) => k.id !== id && currentVersion(k).name === d.name)) return `A skill named "${d.name}" already exists`;
    s.skills[i] = addVersion(s.skills[i], d, "edited", new Date().toISOString(), true);
    return null;
  });
}

export function rollbackSkill(id: string, v: number): Promise<string | null> {
  return update((s) => {
    const i = s.skills.findIndex((k) => k.id === id);
    if (i < 0) return "Skill not found";
    const r = rollback(s.skills[i], v, new Date().toISOString());
    if (typeof r === "string") return r;
    const name = currentVersion(r).name;
    if (s.skills.some((k) => k.id !== id && currentVersion(k).name === name)) return `A skill named "${name}" already exists`;
    s.skills[i] = r;
    return null;
  });
}

/** AGT04: version card, eval result, promote. Each returns an error text or null. */
function mutate(id: string, f: (k: Skill) => Skill | string): Promise<string | null> {
  return update((s) => {
    const i = s.skills.findIndex((k) => k.id === id);
    if (i < 0) return "Skill not found";
    const r = f(s.skills[i]);
    if (typeof r === "string") return r;
    s.skills[i] = r;
    return null;
  });
}
export const cardSkill = (id: string, v: number, body: unknown) => { const c = cleanCard(body); return typeof c === "string" ? Promise.resolve(c) : mutate(id, (k) => setCard(k, v, c)); };
export const evalSkill = (id: string, v: number, pass: boolean, note: string) => mutate(id, (k) => recordEval(k, v, pass, note, new Date().toISOString()));
export const promoteSkill = (id: string, v: number) => mutate(id, (k) => promote(k, v));

export function deleteSkill(id: string): Promise<boolean> {
  return update((s) => { const n = s.skills.length; s.skills = s.skills.filter((k: Skill) => k.id !== id); return s.skills.length < n; });
}

/** "run skill <name>[: input]" → the CORE turn text to run instead (null when it isn't that command). Never throws. */
export async function skillTurn(text: string): Promise<string | null> {
  const cmd = parseRunSkill(text);
  if (!cmd) return null;
  try {
    const want = splitVersion(cmd.name); // "name v2" tries that version
    const k = findSkill(want.name, (await load()).skills);
    if (typeof k === "string") return `(Note from ORBIT: ${k})`;
    const ver = pickVersion(k, want.v);
    if (typeof ver === "string") return `(Note from ORBIT: ${ver})`;
    await mutate(k.id, (x) => logRun(x, ver.v, new Date().toISOString())); // the run keeps the version it ran
    return skillPrompt(ver, cmd.input);
  } catch (e) { console.warn("[skills] run:", e instanceof Error ? e.message : e); return null; }
}
