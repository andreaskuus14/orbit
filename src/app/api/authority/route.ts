import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/supabase/server";
import { authorityState, updateAuthority } from "@/lib/authority";
import { newGrant, setMode, POLICY_VERSION } from "@/lib/authority-pure";
import { stopAllOn } from "@/lib/stop-all";

export const dynamic = "force-dynamic";

// Profile → Authority (standing grants). GET: grants, workflow modes, policy version, Stop-all.
// POST {action:"grant", workflow, actions, limits?, destinations?, account?, project?, expiresAt?} | {action:"pause", id, on} | {action:"revoke", id} | {action:"mode", workflow, mode|null}.
// Grants cover reversible internal actions only (authority-pure newGrant); a change applies at the next action boundary (the file is re-read per check).
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json({ ...authorityState(), policyVersion: POLICY_VERSION, stopAll: stopAllOn() });
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "JSON body required" }, { status: 400 });
  const err = await updateAuthority<string | null>((s) => {
    if (b.action === "grant") { const g = newGrant(b, randomUUID(), Date.now()); return typeof g === "string" ? { out: g } : { out: null, state: { ...s, grants: [...s.grants, g] } }; }
    if (b.action === "mode") { const n = setMode(s, b.workflow, b.mode); return typeof n === "string" ? { out: n } : { out: null, state: n }; }
    if (b.action === "pause" || b.action === "revoke") {
      if (!s.grants.some((g) => g.id === b.id)) return { out: "Grant not found" };
      return { out: null, state: { ...s, grants: s.grants.map((g) => g.id !== b.id ? g : b.action === "revoke" ? { ...g, revoked: true } : { ...g, paused: b.on === true }) } };
    }
    return { out: "Unknown action" };
  });
  return err ? Response.json({ error: err }, { status: 400 }) : GET();
}
