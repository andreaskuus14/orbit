// MCP engine boost (CORE_ENGINE=mcp only; the JSON loop is unchanged): pure parts. Claude Code's own native features on top of
// core-mcp.ts: 1) built-in file tools scoped to the active workspace folder for site builds, 2) deferred tool loading (tool search),
// 3) ORBIT skills (skills/orbit, a session-only plugin) instead of long procedural prompt text, 4) model + effort per turn,
// 5) a static system-prompt prefix for caching. Impure side: core-mcp-boost.ts. Tests: tests/core-mcp-boost-pure.test.ts.
import path from "node:path";
import { explicitBuild, isGoAhead, namedWorkspace, PENDING_MS, type WsGate } from "./ws-intent-pure.ts";
import { SITE_PIPELINE } from "./site-guide.ts";
import { FOLLOW_THROUGH } from "./core-operator-pure.ts";

// ---------- 1. native file tools for website builds ----------

/** The workspace this turn builds in natively: the owner's own explicit build ask (or a go-ahead to CORE's pending Build-it offer)
 *  naming an existing workspace, and nothing untrusted in context yet. null = ORBIT's ws_* tools only (as before). */
export function nativeWorkspace(question: string, gate: WsGate, tainted: boolean, now = Date.now()): string | null {
  if (tainted) return null;
  const p = gate.pending && now - gate.pending.at < PENDING_MS ? gate.pending : null;
  if (p && isGoAhead(question)) return p.workspace;
  return explicitBuild(question) ? namedWorkspace(question, gate.workspaces ?? []) : null;
}

/** Built-in tools per turn: ToolSearch + Skill always; file tools only for a native workspace turn. */
export const nativeTools = (native: boolean) => [...(native ? ["Read", "Edit", "Write", "Glob", "Grep", "Bash"] : []), "ToolSearch", "Skill"];

/** Claude Code permission-rule path for an absolute folder: "//abs/path" (Windows C:\a\b → //c/a/b, the CLI's POSIX form). */
export function rulePath(dir: string): string {
  const p = dir.replace(/\\/g, "/").replace(/\/+$/, "");
  const win = /^([A-Za-z]):\//.exec(p);
  return win ? `//${win[1].toLowerCase()}${p.slice(2)}` : `/${p}`;
}

const BASH_OK = /^node --check (?!-)[\w./-]+$/; // syntax check only: npm/npx/node-run would be arbitrary code outside the folder (no OS sandbox on Windows)
/** --settings permissions for a native workspace turn (with --permission-mode dontAsk anything not allowed is denied).
 *  The PreToolUse hook (preCheck) re-checks every call against the real folder, so these rules are the first fence, not the only one. */
export function wsPermissions(dir: string): { allow: string[]; deny: string[] } {
  const d = rulePath(dir);
  return {
    allow: [`Read(${d}/**)`, `Edit(${d}/**)`, "Bash(node --check *)", "Skill(orbit:*)"],
    deny: [`Read(${d}/**/.env*)`, `Edit(${d}/**/.env*)`, `Edit(${d}/.claude/**)`, `Edit(${d}/.git/**)`, `Edit(${d}/**/CLAUDE.md)`, `Edit(${d}/**/AGENTS.md)`,
      "Bash(curl *)", "Bash(wget *)", "Bash(npm *)", "Bash(npx *)", "Bash(git *)", "WebFetch", "WebSearch"],
  };
}

const inside = (dir: string, p: string, P = path) => { const r = P.relative(dir, p); return r === "" || (!!r && !r.startsWith("..") && !P.isAbsolute(r)); };
const SECRET = /(?:^|[\\/])\.env[^\\/]*$/i;
const NO_WRITE = /(?:^|[\\/])(?:\.claude|\.git|node_modules)(?:[\\/]|$)|(?:^|[\\/])(?:CLAUDE(?:\.local)?\.md|AGENTS\.md|\.mcp\.json)$/i; // files Claude Code itself would load next turn
const FILE_TOOLS = new Set(["Read", "Edit", "Write", "Glob", "Grep", "NotebookEdit"]);

/** The PreToolUse verdict for one built-in call: null = allow, else the deny reason. dir = the workspace's real folder; `real` maps a
 *  path to its real path (symlinks resolved; identity in tests). Taint is read per call, so a page read mid-turn stops later writes. */
export function preCheck(dir: string | null, tool: string, input: Record<string, unknown>, tainted: boolean, real: (p: string) => string = (p) => p, P: typeof path = path): string | null {
  if (tool === "Skill") return /^orbit:[a-z0-9-]+$/.test(String(input.skill ?? "")) ? null : "only ORBIT's own skills (orbit:*) are available";
  if (tool === "ToolSearch" || tool.startsWith("mcp__orbit__")) return null; // ORBIT's tools are gated by decide() in the bridge
  if (!dir) return "no workspace folder is open in this turn";
  const writes = tool === "Edit" || tool === "Write" || tool === "NotebookEdit" || tool === "Bash";
  if (writes && tainted) return "workspace files change only for the user's own request, before any page, file or agent output is in context";
  if (tool === "Bash") {
    const cmd = String(input.command ?? "").trim();
    if (!BASH_OK.test(cmd)) return "only `node --check <file>` runs here; start and check the site with ws_run (sandboxed) instead";
    const f = cmd.slice("node --check ".length);
    return inside(dir, real(P.resolve(dir, f)), P) ? null : "that file is outside the workspace folder";
  }
  if (!FILE_TOOLS.has(tool)) return `${tool} is not available in ORBIT`;
  const raw = String(input.file_path ?? input.notebook_path ?? input.path ?? "");
  const target = real(P.resolve(dir, raw || "."));
  if (!inside(dir, target, P)) return `only files inside the workspace folder ${dir} are allowed`;
  for (const k of ["pattern", "glob"] as const) if (tool !== "Grep" || k === "glob") { const g = String(input[k] ?? ""); if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(g) || P.isAbsolute(g) || /^~/.test(g)) return "patterns must stay inside the workspace folder"; }
  if (SECRET.test(target)) return ".env files are never read or written";
  if (writes && NO_WRITE.test(P.relative(dir, target))) return "that path holds tool configuration and stays read-only";
  return null;
}
/** Claude Code PreToolUse hook output for a verdict. */
export const hookOut = (reason: string | null) => (reason ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `ORBIT: ${reason}` } } : {});

/** Paths the native turn changed (from allowed Edit/Write calls), relative to the workspace. */
export const editedPath = (dir: string, tool: string, input: Record<string, unknown>, P: typeof path = path): string | null =>
  tool === "Edit" || tool === "Write" ? P.relative(dir, P.resolve(dir, String(input.file_path ?? ""))).replace(/\\/g, "/") || null : null;

/** System-prompt note for a native workspace turn. */
export const nativeNote = (slug: string, dir: string) => `<workspace_files>
This turn works on workspace "${slug}", folder ${dir} (your working directory). Use Read, Glob, Grep, Edit and Write on its files directly instead of ws_read/ws_write: edit only what changes. Only this folder is reachable; .env files and tool configuration are off limits; Bash runs only \`node --check <file>\`. When the edits are done, end your turn: ORBIT then runs the site check (full-stack: the ws_run smoke check) and tells you if anything is still failing. Nothing is deployed or published.
</workspace_files>`;

// ---------- 2. deferred tool loading ----------

/** The CLI's tool search: MCP tool schemas load on demand (ToolSearch), only names sit in the prompt. Verified on Claude Code 2.1.316. */
export const TOOL_SEARCH_ENV = { ENABLE_TOOL_SEARCH: "true" } as const;
/** shortcut: chars/4 token estimate, good for before/after ratios; use the CLI's usage numbers for absolute counts. */
export const approxTokens = (s: string) => Math.ceil(s.length / 4);
export const loadedTokens = (tools: readonly { name: string; description: string; inputSchema: unknown }[]) => approxTokens(JSON.stringify(tools));
export const deferredTokens = (names: readonly string[]) => approxTokens(names.map((n) => `mcp__orbit__${n}`).join("\n"));

// ---------- 3. ORBIT skills ----------

/** The lead-finding procedure inside FOLLOW_THROUGH (moved to the orbit:lead-hunting skill for the mcp engine). */
export const LEAD_RULE = /For "find X[\s\S]*?until the count is met\. /.exec(FOLLOW_THROUGH)?.[0] ?? "";
export type Skill = { name: string; description: string; moved: string[] };
/** Each skill and the exact prompt text it replaces in the mcp engine (skills/orbit/skills/<name>/SKILL.md holds the text). */
export const SKILLS: Skill[] = [
  { name: "site-building", description: "ORBIT's step-by-step pipeline and design guide for building or redesigning a website in a workspace (plan.md, layout, pages, pictures, check and fix rounds). Use for any new site, landing page or big redesign.", moved: [SITE_PIPELINE] },
  { name: "lead-hunting", description: "How ORBIT finds and verifies BUSINESS leads that match a condition (no website, outdated site...) before saving them with lead_create, until the asked count is met.", moved: [LEAD_RULE] },
];
const POINTER = (s: Skill) => `(${s.name}: load the orbit:${s.name} skill)`;
const LEAD_HINT = /PLAN HINT \(lead finding with a condition\):[^\n]*\n\n/g;
/** The mcp engine's prompt text with the moved procedures swapped for a one-line pointer to their skill. */
export function stripSkills(text: string): string {
  let out = text;
  for (const s of SKILLS) for (const m of s.moved) if (m) out = out.split(m.trim()).join(POINTER(s));
  return out.replace(LEAD_HINT, `${POINTER(SKILLS[1])}\n\n`);
}
export const SKILLS_NOTE = `<skills>
ORBIT skills hold step-by-step procedures: ${SKILLS.map((s) => `orbit:${s.name} (${s.description.split(".")[0]})`).join("; ")}. Load the matching one with the Skill tool before starting that kind of work.
</skills>`;
/** SKILL.md → {name, description, body}; null when the frontmatter is missing or incomplete. */
export function parseSkill(md: string): { name: string; description: string; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(md);
  if (!m) return null;
  const field = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(m[1])?.[1].trim() ?? "";
  const name = field("name"), description = field("description");
  return name && description && /^[a-z0-9-]{1,64}$/.test(name) ? { name, description, body: m[2] } : null;
}

// ---------- 4. model + effort routing ----------

export type ModelPref = "auto" | "opus" | "sonnet";
export const parsePref = (v: unknown): ModelPref => (v === "opus" || v === "sonnet" ? v : "auto");
export type Models = { fast: string; smart: string; deep: string };
export type Route = { model: string; effort?: string; tier: "fast" | "smart" | "deep"; why: string };
const PLAN = /\b(?:plan|roadmap|strategy|architect|design (?:a|the|my)|break (?:it|this) down)\b|planeeri|kava\b|strateegi/i;
/** Model + effort for one mcp turn: site builds and planning → deep (Opus, high); routine tool work → smart (Sonnet); short chit-chat
 *  stays fast (Haiku; core.ts escalates it if it reaches for a tool). A Profile pref other than auto pins the model. */
export function routeTurn(o: { question: string; tier: "fast" | "smart" | "deep"; pref: ModelPref; build: boolean; models: Models; effort?: string }): Route {
  const deep = (why: string): Route => ({ model: o.models.deep, effort: o.effort || "high", tier: "deep", why });
  if (o.pref === "opus") return deep("Profile: always Opus");
  if (o.pref === "sonnet") return { model: o.models.smart, tier: "smart", why: "Profile: always Sonnet" };
  if (o.build) return deep("site build");
  if (o.tier === "deep") return deep("hard request");
  if (o.tier !== "fast" && PLAN.test(o.question)) return deep("planning");
  return o.tier === "fast" ? { model: o.models.fast, tier: "fast", why: "short chat" } : { model: o.models.smart, tier: "smart", why: "routine tool work" };
}
/** One tier down after a usage-limit result (Opus → Sonnet → Haiku), else null. */
export function downTier(r: Route, m: Models): Route | null {
  if (r.tier === "deep") return { model: m.smart, tier: "smart", why: `${r.why}; Opus limit → Sonnet` };
  if (r.tier === "smart") return { model: m.fast, tier: "fast", why: `${r.why}; Sonnet limit → Haiku` };
  return null;
}
export const isLimitError = (e: unknown) => /usage limit|hit your limit|rate_limit|API Error: 429|rate limit (?:reached|exceeded)|overloaded/i.test(e instanceof Error ? e.message : String(e));

// ---------- 5. stable prompt prefix ----------

const TODAY = /\s*Today is [^;\n]*; the exact local time is in each request's NOW line\./;
const PROFILE = /\n\nUser profile \(stated by the user\):\n(?:[^\n]+\n?)*/; // up to the next blank line (ACTION_BLOCK may follow)
/** The mcp system prompt with every per-day/per-user part at the very end, so the static rules + tool notes form one cacheable prefix.
 *  Memories, time, entity cards and lessons already travel in the user message (core.ts prep). */
export function stableSystem(system: string, blocks: string[]): string {
  const today = TODAY.exec(system)?.[0].trim() ?? "", profile = PROFILE.exec(system)?.[0].trim() ?? "";
  const rest = system.replace(TODAY, "").replace(PROFILE, "");
  return [rest, ...blocks.filter(Boolean), [today, profile].filter(Boolean).join("\n\n")].filter(Boolean).join("\n\n");
}
/** Length of the shared prefix of two strings (cache-prefix test helper). */
export const sharedPrefix = (a: string, b: string) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
