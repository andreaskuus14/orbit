import path from "node:path";
import { readStoreSync, StoreUnreadable, writeStore } from "./safe-file.ts";
import { orbitDataDir } from "./data-dir.ts";
import { stopAllOn } from "./stop-all.ts";
import { contentHash } from "./approval-pure.ts";
import { authorityDefaults, authorize, consume, parseAuthority, type AuthCtx, type AuthorityState, type Verdict } from "./authority-pure.ts";
import type { Decision } from "./policy-pure.ts";

// The one action boundary (authority-pure.ts) wired to <ORBIT data dir>/authority.json and Stop-all.
// The file is re-read on every check, so a revoke/pause/hold (any process) applies at the very next action boundary.

const file = () => path.join(orbitDataDir(), "authority.json");
const g = globalThis as unknown as { __orbitAuthSave?: Promise<unknown> };

/** Missing file = no grants or modes. Locked/damaged: left untouched, and nothing runs on its own (authorize refuses) until it reads again. */
export function authorityState(): AuthorityState {
  try { return parseAuthority(readStoreSync(file()) || "{}"); }
  catch (e) { return locked(e); }
}
const locked = (e: unknown): AuthorityState => ({ ...authorityDefaults(), unreadable: `Permissions couldn't be loaded (${e instanceof Error ? e.message : e}), so nothing runs on its own until that's fixed` });

/** Serialized read-modify-write (atomic save). Unreadable file: throws StoreUnreadable, nothing written. fn returns the new state, or a string = refused (nothing written). */
export async function updateAuthority<T>(fn: (s: AuthorityState) => { state?: AuthorityState; out: T }): Promise<T> {
  const p = (g.__orbitAuthSave ?? Promise.resolve()).catch(() => {}).then(async () => {
    const r = fn(parseAuthority(readStoreSync(file()) || "{}")); // unreadable throws: never saved over
    if (r.state) await writeStore(file(), JSON.stringify(r.state));
    return r.out;
  });
  g.__orbitAuthSave = p;
  return p;
}

type Ctx = Omit<AuthCtx, "state" | "now" | "stopAll" | "approval">;

/** Background/agent/rule/automation/remote/retry entry: verdict + grant use counted under the same lock (limits hold in-process).
 *  shortcut: two processes using one grant at the same instant could both pass a count limit by one; add a file lock if grants get money limits in use. */
export const authorizeAction = (action: string, ctx: Ctx): Promise<Verdict> =>
  updateAuthority((state) => {
    const v = authorize(action, { ...ctx, state, now: Date.now(), stopAll: stopAllOn() });
    return { out: v, state: v.ok && v.by === "grant" && v.grantId ? consume(state, v.grantId, ctx) : undefined };
  }).catch((e) => { if (!(e instanceof StoreUnreadable)) throw e; return authorize(action, { ...ctx, state: locked(e), now: Date.now(), stopAll: stopAllOn() }); }); // the refusing verdict, not a throw

/** Consequential sends/spends/publishes/signs: "" = go, else why not. The content's hash must equal the one his click carried. */
export async function authorizeApproval(action: string, approved: unknown, content: unknown, ctx: Partial<Ctx> = {}): Promise<string> {
  const v = authorize(action, { entry: "owner", ownerClick: true, ...ctx, approval: { approved, hash: await contentHash(content) }, state: authorityState(), now: Date.now(), stopAll: false });
  return v.ok ? "" : v.why; // stopAll false: each send path keeps its own Stop-all refusal and status code
}

/** CORE and SDK tool calls: decide()'s verdict passed through the boundary (his chat ask = ownerClick; decide() checked it, incl. Stop-all per tool). */
export function authorizeTool(tool: string, d: Decision): Decision {
  const v = authorize(tool, { entry: "core", ownerClick: true, deferred: true, decision: d, stopAll: false, state: authorityState(), now: Date.now() });
  return v.ok ? d : { ...d, allow: false, reason: v.why };
}
