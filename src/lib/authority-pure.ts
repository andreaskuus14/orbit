// Standing grants + the one action boundary (roadmap A03/A04). Client-safe, no node imports.
// authorize() is the single verdict every effectful entry point asks for: policy (decide/Stop-all) first, then
//  - consequential effects (send/spend/publish/sign): ONLY the owner's exact-content approval hash; a grant never covers them (AGENTS.md rule 6),
//  - reversible internal actions: the owner's own click/ask, a legacy path (workflow with no mode set), or an active matching grant.
// Entry points (core, sdk, agent, rule, automation, remote, retry) never change the verdict: the same ctx gives the same answer.
// Operate mode is defined but cannot be switched on in this version: see docs/AUTHORITY-POLICY-PROPOSAL.md.
import { EFFECTS, isConsequential } from "./approval-pure.ts";

/** Bumped whenever the rules below change; grants and bindings from another version stop working (re-grant / re-approve). */
export const POLICY_VERSION = "2026-10-29.1";

export const MODES = ["observe", "prepare", "operate", "hold"] as const;
export type Mode = (typeof MODES)[number];
export const MODE_TEXT: Record<Mode, string> = {
  observe: "Observe: reads only; no changes without your click",
  prepare: "Prepare: reversible changes inside its grants; nothing leaves ORBIT",
  operate: "Operate: outward actions inside its grants (not available yet)",
  hold: "Exception hold: nothing runs on its own until you look",
};
export const ENTRIES = ["owner", "core", "sdk", "agent", "rule", "automation", "remote", "retry"] as const;
export type Entry = (typeof ENTRIES)[number];

export type Limits = { count?: number; money?: number; calls?: number };
export type Grant = {
  id: string; workflow: string; account?: string; project?: string; actions: string[]; limits: Limits; destinations: string[];
  policyVersion: string; expiresAt?: string; revoked: boolean; paused: boolean; used: { count: number; money: number; calls: number }; createdAt: string;
};
export type AuthorityState = { grants: Grant[]; modes: Record<string, Mode> };
export const authorityDefaults = (): AuthorityState => ({ grants: [], modes: {} });

export type AuthCtx = {
  entry: Entry; workflow?: string; account?: string; project?: string; destination?: string; money?: number; calls?: number;
  ownerClick?: boolean; // his own click or his latest message asked (decide() checked the explicit ask)
  stopAll: boolean; decision?: { allow: boolean; reason: string }; // policy-pure decide() verdict, when the entry has one
  approval?: { approved: unknown; hash: string }; // consequential: hash his click carried + hash of the content about to leave
  deferred?: boolean; // only queues work whose effect passes authorize() again at its execution point (DEFERRED)
  binding?: string; // a binding from an earlier verdict (retry / resume): must still match
  state: AuthorityState; now: number;
};
export type Verdict = { ok: boolean; why: string; by: "policy" | "owner" | "approval" | "grant" | "legacy" | "none"; grantId?: string; binding: string };

/** Consequential CORE tools that only queue items each passing their own execution-time approval gate (factory startPublish). */
export const DEFERRED = ["schedule_approved"];

const grantActive = (g: Grant, now: number) =>
  !g.revoked && !g.paused && g.policyVersion === POLICY_VERSION && (!g.expiresAt || Date.parse(g.expiresAt) > now);

/** Why grant `g` doesn't cover this action ("" = it does). */
export function grantMiss(g: Grant, action: string, c: AuthCtx): string {
  if (g.revoked) return "grant revoked";
  if (g.paused) return "grant paused";
  if (g.policyVersion !== POLICY_VERSION) return "grant was made under an older policy; grant it again";
  if (g.expiresAt && Date.parse(g.expiresAt) <= c.now) return "grant expired";
  if (g.workflow !== c.workflow) return "other workflow";
  if (!g.actions.includes(action)) return `"${action}" is not in the grant`;
  if (g.account && g.account !== c.account) return "other account";
  if (g.project && g.project !== c.project) return "other project";
  if (c.destination !== undefined && !g.destinations.includes(c.destination.trim().toLowerCase())) return "destination not in the grant's allow-list";
  if (g.limits.count !== undefined && g.used.count + 1 > g.limits.count) return "grant's action count used up";
  if (g.limits.money !== undefined && g.used.money + (c.money ?? 0) > g.limits.money) return "grant's money limit reached";
  if (g.limits.calls !== undefined && g.used.calls + (c.calls ?? 0) > g.limits.calls) return "grant's call limit reached";
  if (g.limits.money === undefined && (c.money ?? 0) > 0) return "grant has no money limit";
  return "";
}

export function authorize(action: string, c: AuthCtx): Verdict {
  const v = (ok: boolean, why: string, by: Verdict["by"], grantId?: string): Verdict => {
    const binding = `${POLICY_VERSION}|${grantId ?? "-"}|${c.approval?.hash ?? "-"}`;
    if (ok && c.binding !== undefined && c.binding !== binding) return { ok: false, why: "stale: the policy, grant or content changed since this was decided; decide again", by: "none", binding };
    return { ok, why, by, grantId, binding };
  };
  const effect = EFFECTS[action];
  if (!effect) return v(false, `unknown action "${action}"`, "none");
  if (c.decision && !c.decision.allow) return v(false, c.decision.reason, "policy");
  if (effect === "read") return v(true, "read", "policy");
  if (c.stopAll) return v(false, "Stop-all is on", "policy");
  const mode = c.workflow ? c.state.modes[c.workflow] : undefined;
  if (mode === "hold" && !c.ownerClick) return v(false, "workflow is on exception hold", "none");

  if (isConsequential(action)) { // never via a grant, whatever the mode or entry
    if (c.deferred && DEFERRED.includes(action)) return v(true, "queues only; each item passes its own approval gate", "approval");
    if (typeof c.approval?.approved !== "string" || !c.approval.approved) return v(false, "Needs your approval of this exact version: reload and read it first", "none");
    return c.approval.approved === c.approval.hash ? v(true, "your approval of this exact version", "approval") : v(false, "The content changed since you approved it: reload and read it again", "none");
  }
  // reversible
  if (c.ownerClick) return v(true, "your click", "owner");
  if (!mode) return v(true, "no standing-grant mode set for this workflow (existing gates apply)", "legacy");
  if (mode === "observe") return v(false, "workflow is in Observe mode: changes need your click", "none");
  const misses = c.state.grants.filter((g) => g.workflow === c.workflow).map((g) => ({ g, why: grantMiss(g, action, c) }));
  const hit = misses.find((m) => !m.why);
  if (hit) return v(true, "standing grant", "grant", hit.g.id);
  return v(false, `not covered by a grant${misses.length ? `: ${misses.map((m) => m.why).join("; ")}` : ""}`, "none");
}

/** Count one authorized use against its grant (call after a grant verdict). */
export const consume = (s: AuthorityState, grantId: string, c: Pick<AuthCtx, "money" | "calls">): AuthorityState => ({
  ...s, grants: s.grants.map((g) => g.id === grantId ? { ...g, used: { count: g.used.count + 1, money: g.used.money + (c.money ?? 0), calls: g.used.calls + (c.calls ?? 0) } } : g),
});

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined);
const str = (x: unknown, max = 200) => (typeof x === "string" && x.trim() ? x.trim().slice(0, max) : undefined);

/** A new grant from untrusted input, or why not. Only reversible internal actions can be granted in this policy version. */
export function newGrant(b: Record<string, unknown>, id: string, now: number): Grant | string {
  const workflow = str(b.workflow, 100);
  if (!workflow) return "workflow required";
  const actions = Array.isArray(b.actions) ? [...new Set(b.actions.filter((a): a is string => typeof a === "string"))] : [];
  if (!actions.length) return "at least one action required";
  const bad = actions.find((a) => EFFECTS[a] !== "reversible");
  if (bad) return `"${bad}" can't be granted: only reversible internal actions; sends, spends, publishing and signing always need your click on the exact version`;
  const l = (b.limits ?? {}) as Record<string, unknown>;
  const expiresAt = str(b.expiresAt, 40);
  if (expiresAt && !(Date.parse(expiresAt) > now)) return "expiry must be a future date";
  return {
    id, workflow, account: str(b.account), project: str(b.project), actions, limits: { count: num(l.count), money: num(l.money), calls: num(l.calls) },
    destinations: Array.isArray(b.destinations) ? b.destinations.filter((d): d is string => typeof d === "string").map((d) => d.trim().toLowerCase()).filter(Boolean).slice(0, 50) : [],
    policyVersion: POLICY_VERSION, expiresAt, revoked: false, paused: false, used: { count: 0, money: 0, calls: 0 }, createdAt: new Date(now).toISOString(),
  };
}

/** Mode change, or why not. Operate is refused until the owner changes AGENTS.md (docs/AUTHORITY-POLICY-PROPOSAL.md). */
export function setMode(s: AuthorityState, workflow: unknown, mode: unknown): AuthorityState | string {
  const w = str(workflow, 100);
  if (!w) return "workflow required";
  if (mode === null) { const modes = { ...s.modes }; delete modes[w]; return { ...s, modes }; }
  if (!MODES.includes(mode as Mode)) return "unknown mode";
  if (mode === "operate") return "Operate mode is not enabled: outward actions still need your click on the exact version (see docs/AUTHORITY-POLICY-PROPOSAL.md)";
  return { ...s, modes: { ...s.modes, [w]: mode as Mode } };
}

/** Guarded load of the stored file: anything malformed is dropped; a stored "operate" (or a non-reversible action) never loads. */
export function parseAuthority(text: string): AuthorityState {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return authorityDefaults(); }
  const o = (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
  const grants = (Array.isArray(o.grants) ? o.grants : []).filter((g): g is Grant => !!g && typeof g === "object" && typeof g.id === "string" && typeof g.workflow === "string"
    && Array.isArray(g.actions) && g.actions.every((a: unknown) => typeof a === "string" && EFFECTS[a] === "reversible") && typeof g.policyVersion === "string"
    && !!g.used && !!g.limits && Array.isArray(g.destinations))
    .map((g) => ({ ...g, revoked: g.revoked !== false, paused: g.paused === true })); // missing flag = revoked (fail closed)
  const modes: Record<string, Mode> = {};
  for (const [w, m] of Object.entries((o.modes ?? {}) as Record<string, unknown>)) if (MODES.includes(m as Mode) && m !== "operate") modes[w] = m as Mode;
  return { grants, modes };
}

export const grantLive = grantActive;
