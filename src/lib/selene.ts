// GAME DEV → automatic Selene check after a Rojo export, IO half (selene-pure.ts has the rules). Local only: runs `selene` with fixed
// arguments and no shell inside the exported project, then saves the result on the dev session and files NEW errors as backlog bugs
// (records only). Never throws: a missing selene, a timeout or a full disk must not fail the export that already succeeded.
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { importDrafts } from "./backlog-pure";
import { validateDevWorld, type DevWorld } from "./devworld-pure";
import { eventFromSelene } from "./dev-session-pure";
import { INSTALL_HINT, countFindings, draftFor, newErrors, parseFindings, seleneCandidates, summaryText, type SeleneRun } from "./selene-pure";

const TIMEOUT_MS = 120_000;
const CAP = 4_000_000;
const WIN = process.platform === "win32";

/** First selene that exists, or null (the caller then says how to install it). */
export function findSelene(projectDir: string): string | null {
  const list = seleneCandidates({ env: process.env.ORBIT_SELENE, home: os.homedir(), win: WIN, projectDir, path: process.env.PATH ?? "", sep: path.delimiter });
  return list.find((p) => { try { return statSync(p).isFile(); } catch { return false; } }) ?? null;
}

function exec(bin: string, cwd: string): Promise<{ out: string; code: number | null; timedOut: boolean } | { error: string }> {
  return new Promise((resolve) => {
    let out = "", timedOut = false;
    const child = spawn(bin, ["--display-style", "json2", "src"], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, TIMEOUT_MS);
    child.stdout.setEncoding("utf8").on("data", (d: string) => { if (out.length < CAP) out += d; });
    child.on("error", (e) => { clearTimeout(timer); resolve({ error: e.message }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ out, code, timedOut }); });
  });
}

/** Selene (read-only) on <projectDir>/src. A project without files on disk is skipped; so is a machine without selene. */
export async function runSelene(projectDir: string): Promise<SeleneRun> {
  if (!existsSync(path.join(projectDir, "src"))) return { status: "no-files", hint: "No source files on disk (a Studio-only build), so Selene was skipped." };
  const bin = findSelene(projectDir);
  if (!bin) return { status: "missing", hint: INSTALL_HINT };
  const r = await exec(bin, projectDir);
  if ("error" in r) return { status: "failed", hint: `Selene couldn't start: ${r.error.slice(0, 200)}` };
  if (r.timedOut) return { status: "failed", hint: `Selene took longer than ${TIMEOUT_MS / 1000} s and was stopped.` };
  const findings = parseFindings(r.out);
  if (!findings) return { status: "failed", hint: `Selene gave no result (exit ${r.code}).` };
  return { status: "ok", findings };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The game the project belongs to: same name (ignoring case and punctuation). Null when there's none: nothing is filed then. */
const gameFor = (w: DevWorld, project: string) => w.games.find((g) => norm(g.name) === norm(project));

async function fileBugs(sb: SupabaseClient, project: string, run: Extract<SeleneRun, { status: "ok" }>): Promise<{ filed: number; known: number; overflow: number; unfiled?: string }> {
  const none = { filed: 0, known: 0, overflow: 0 };
  if (!countFindings(run.findings).errors) return none;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await sb.from("game_saves").select("save, updated_at").eq("game", "devworld").maybeSingle();
    if (error || !data?.save) return { ...none, unfiled: "no game list saved yet, nothing filed" };
    const v = validateDevWorld(data.save);
    if (!v.ok) return { ...none, unfiled: "game list unreadable, nothing filed" };
    const game = gameFor(v.world, project);
    if (!game) return { ...none, unfiled: `no game called "${project}" in GAME DEV, nothing filed` };
    const d = newErrors(run.findings, v.world.bugs, game.id);
    if (!d.fresh.length) return { filed: 0, known: d.known, overflow: d.overflow };
    const out = importDrafts(v.world, game.id, d.fresh.map(draftFor), new Date().toISOString(), () => crypto.randomUUID());
    if (!out.added) return { filed: 0, known: d.known + d.fresh.length, overflow: d.overflow, ...(out.world.bugs.length >= 500 && { unfiled: "backlog is full" }) };
    const w = await sb.from("game_saves").update({ save: out.world, updated_at: new Date().toISOString() }).eq("game", "devworld").eq("updated_at", data.updated_at).select("game");
    if (!w.error && w.data?.length) return { filed: out.added, known: d.known, overflow: d.overflow };
    // changed in another tab meanwhile: read again once
  }
  return { ...none, unfiled: "backlog changed while saving, nothing filed" };
}

export type AfterExport = { status: SeleneRun["status"]; text: string; errors: number; warnings: number; filed: number };

/** Called after a successful Rojo export. Best effort: never throws. */
export async function checkAfterExport(sb: SupabaseClient, userId: string, ex: { name: string; dir: string }): Promise<AfterExport> {
  try {
    const run = await runSelene(ex.dir);
    if (run.status !== "ok") return { status: run.status, text: run.hint, errors: 0, warnings: 0, filed: 0 };
    const c = countFindings(run.findings);
    const filed = await fileBugs(sb, ex.name, run).catch((e) => ({ filed: 0, known: 0, overflow: 0, unfiled: `couldn't save to the backlog (${e instanceof Error ? e.message : e})`.slice(0, 120) }));
    const text = summaryText(ex.name, run.findings, filed);
    const line = (f: (typeof run.findings)[number]) => `${f.file}:${f.line} [${f.code}] ${f.message}`;
    const { recordDevEvent } = await import("./dev-session");
    await recordDevEvent(sb, userId, eventFromSelene(ex.name, run.findings.filter((f) => f.severity === "error").map(line), run.findings.filter((f) => f.severity === "warning").map(line), `${c.errors} errors, ${c.warnings} warnings${filed.filed ? `, ${filed.filed} filed` : ""}`));
    return { status: "ok", text, errors: c.errors, warnings: c.warnings, filed: filed.filed };
  } catch (e) {
    return { status: "failed", text: `Selene check failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200), errors: 0, warnings: 0, filed: 0 };
  }
}
