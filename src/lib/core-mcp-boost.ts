// MCP engine boost (core-mcp.ts hooks; pure parts and why: core-mcp-boost-pure.ts). One boostTurn() per mcp turn gives core-mcp.ts
// the routed model/effort (with a one-tier fallback on a usage limit), the cache-friendly system prompt, the CLI extras (built-in
// tools, tool search, ORBIT skills plugin, workspace cwd + permission rules) and the PreToolUse / pre-stop handlers.
import { readFileSync, realpathSync } from "node:fs";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEEP_EFFORT, DEEP_MODEL, FAST_MODEL, MODEL, type McpAccess } from "./claude";
import { orbitDataDir } from "./data-dir";
import { logActivity } from "./activity";
import { siteCheck, verifiedLine, wsTainted } from "./core-workspace";
import { stepLine } from "./core-sdk-pure";
import type { WsGate } from "./ws-intent-pure";
import type { WriteEvidence } from "./completion-pure";
import {
  SKILLS_NOTE, TOOL_SEARCH_ENV, downTier, editedPath, hookOut, isLimitError, nativeNote, nativeTools, nativeWorkspace, parsePref, preCheck,
  routeTurn, stableSystem, stripSkills, wsPermissions, type ModelPref, type Route,
} from "./core-mcp-boost-pure";

// ---------- Profile → CORE engine → model (Auto / always Opus / always Sonnet) ----------
const file = () => path.join(orbitDataDir(), "core-model.json");
const g = globalThis as unknown as { __orbitModelPref?: ModelPref };
export const coreModelPref = (): ModelPref => (g.__orbitModelPref ??= (() => { try { return parsePref(JSON.parse(readFileSync(file(), "utf8")).pref); } catch { return "auto"; } })());
export async function setCoreModelPref(v: unknown): Promise<ModelPref> {
  const pref = parsePref(v);
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file() + ".tmp", JSON.stringify({ pref, at: new Date().toISOString() }));
  await rename(file() + ".tmp", file());
  return (g.__orbitModelPref = pref);
}

type BoostIn = {
  userId: string; question: string; system: string; prompt: string; model: string; effort?: string; steps: string[]; trace: { step: string; detail: string; ms: number; ok: boolean }[];
  policy: () => { ws?: WsGate; attach?: boolean; pins?: boolean; carried?: boolean };
  record: (tool: string, input: Record<string, unknown>, out: string, evidence: WriteEvidence[], ms: number) => void;
  signal?: AbortSignal; risky?: boolean; onRoute?: (model: string) => void;
};
const MODELS = { fast: FAST_MODEL, smart: MODEL, deep: DEEP_MODEL };
const tierOf = (model: string) => (model === FAST_MODEL ? "fast" : model === DEEP_MODEL ? "deep" : "smart") as Route["tier"];
const realish = (p: string): string => { // the real path of p, or of its nearest existing parent + the rest (a new file)
  try { return realpathSync(p); } catch { const up = path.dirname(p); return up === p ? p : path.join(realish(up), path.basename(p)); }
};

export async function boostTurn(t: BoostIn) {
  const c = t.policy();
  const tainted = () => !!(c.attach || c.pins || c.carried) || wsTainted(t.steps, t.question);
  const slug = nativeWorkspace(t.question, c.ws ?? {}, tainted());
  const ws = slug ? await import("./workspace").then((w) => w.workspaceDir(t.userId, slug)).catch(() => null) : null;
  const dir = ws ? await realpath(ws) : null;
  let route = routeTurn({ question: t.question, tier: tierOf(t.model), pref: coreModelPref(), build: !!dir, models: MODELS, effort: t.effort || DEEP_EFFORT, risky: t.risky });
  t.trace.push({ step: "route", detail: `${route.model}${route.effort ? ` · effort ${route.effort}` : ""} · ${route.why}${dir ? ` · native files in ${slug}` : ""}`, ms: 0, ok: true });

  const edited = new Set<string>();
  let checks = 0, problems = "", limitFrom: string | undefined;
  return {
    get route() { return route; },
    /** The model a usage limit first stepped this turn down from (model.run log), if any. */
    get limitFrom() { return limitFrom; },
    native: dir ? { slug: slug!, dir } : null,
    system: stableSystem(stripSkills(t.system), [SKILLS_NOTE, dir ? nativeNote(slug!, dir) : ""]),
    prompt: stripSkills(t.prompt),
    /** Extra McpAccess fields for askClaude. */
    access: (base: McpAccess): McpAccess => ({ ...base, tools: nativeTools(!!dir), env: { ...base.env, ...TOOL_SEARCH_ENV }, pluginDir: path.join(process.cwd(), "skills", "orbit"), ...(dir ? { cwd: dir } : {}) }),
    /** The per-turn --settings JSON: core-mcp.ts's hooks + the PreToolUse hook + the workspace permission rules. */
    settings: (base: { hooks: Record<string, unknown> }, node: string, bridgeFile: string) => ({
      ...base,
      hooks: { ...base.hooks, PreToolUse: [{ matcher: "Read|Edit|Write|Glob|Grep|Bash|NotebookEdit|Skill|WebFetch|WebSearch|Task|Agent", hooks: [{ type: "command", command: `"${node}" "${path.join(process.cwd(), "scripts", "orbit-mcp-hook.mjs").replace(/\\/g, "/")}" "${bridgeFile}"`, timeout: 30 }] }] },
      permissions: dir ? wsPermissions(dir) : { allow: ["Skill(orbit:*)"], deny: [] },
    }),
    /** Bridge /pre: the PreToolUse verdict for one built-in call. */
    pre: (b: Record<string, unknown>) => {
      const tool = String(b.tool_name ?? ""), input = (b.tool_input && typeof b.tool_input === "object" ? b.tool_input : {}) as Record<string, unknown>;
      const why = t.signal?.aborted ? "the turn was stopped" : preCheck(dir, tool, input, tainted(), realish);
      if (why) t.trace.push({ step: "native", detail: `refused ${tool}: ${why}`.slice(0, 200), ms: 0, ok: false });
      else if (dir) { const p = editedPath(dir, tool, input); if (p) edited.add(p); }
      return hookOut(why);
    },
    /** Before the done-gate: native edits since the last check get ORBIT's site check (full-stack: ws_run) as a ws_write row, so the
     *  receipt and the gate judge them like a ws_write. Returns the open problems for the gate's block reason ("" = none). */
    beforeGate: async (): Promise<string> => {
      if (!dir || !edited.size) return "";
      const files = [...edited]; edited.clear();
      const at = Date.now();
      const fullstack = await readFile(path.join(dir, "server.mjs")).then(() => true, () => false);
      const out = fullstack
        ? await import("./core-workspace").then((w) => w.runWsTool(t.userId, "ws_run", { workspace: slug }, t.question, false, checks))
        : `Workspace ${slug}: ${files.length} file(s) edited natively.${await siteCheck(t.userId, slug!, checks, t.question)}`;
      checks++;
      const evidence: WriteEvidence[] = files.map((p) => ({ kind: "file", id: slug!, path: p, check: verifiedLine(out) }));
      const input = { workspace: slug, files: files.map((p) => ({ path: p })), native: true };
      t.steps.push(stepLine("ws_write", input, out));
      t.record("ws_write", input, out, evidence, Date.now() - at);
      problems = /Problems the headless check found|Still open|^Error:/m.test(out) ? `\n${out.slice(out.indexOf("Check:") >= 0 ? out.indexOf("Check:") : 0, 2500)}` : "";
      return problems;
    },
    /** Runs the CLI on the routed model; a usage-limit failure retries once per tier down (Opus → Sonnet → Haiku), noted in Activity. */
    run: async <R>(go: (model: string, effort: string | undefined) => Promise<R>): Promise<R> => {
      for (;;) {
        t.onRoute?.(route.model); // again after each usage-limit step-down
        try { return await go(route.model, route.effort); }
        catch (e) {
          const next = isLimitError(e) ? downTier(route, MODELS) : null;
          if (!next) throw e;
          limitFrom ??= route.model;
          logActivity({ area: "core", title: `CORE: ${route.model} usage limit reached; this turn continues on ${next.model}` });
          t.trace.push({ step: "fallback", detail: `${route.model} limit → ${next.model}`, ms: 0, ok: false });
          route = next;
        }
      }
    },
  };
}
