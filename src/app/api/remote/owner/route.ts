import { requireUser } from "@/lib/supabase/server";
import { listDevices, newPair, remoteProblem, S, updateDevices } from "@/lib/remote";
import { createShortcut, listShortcuts, revokeShortcut } from "@/lib/remote-shortcut";
import { isShortcutAction } from "@/lib/remote-shortcut-pure";

export const dynamic = "force-dynamic";

// PC side of the phone remote (owner signed in). GET: {problem, pair, devices}. POST {action:"pair"} shows a fresh 2-minute code;
// {action:"revoke", id} unpairs a device at once (its token stops working on the next request). Shortcuts & Watch:
// {action:"shortcut", kind, name} makes a one-action token (returned once, as `token`); {action:"revokeShortcut", id} deletes it.
const view = async () => {
  const p = S.pair;
  const live = p && !p.used && p.fails < 5 && Date.now() < p.expiresAt;
  const devices = (await listDevices()).map(({ id, name, createdAt, type }) => ({ id, name: type === "screen" ? `${name} (read-only screen)` : name, createdAt, lastSeen: S.seen.get(id) ?? null }));
  const shortcuts = (await listShortcuts()).map(({ id, name, action, createdAt }) => ({ id, name, action, createdAt, lastSeen: S.seen.get(`sc:${id}`) ?? null }));
  return { problem: remoteProblem(), pair: live ? { code: p.code, expiresAt: p.expiresAt } : null, devices, shortcuts };
};

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json(await view());
}

export async function POST(req: Request) {
  const { user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { action?: unknown; id?: unknown; kind?: unknown; name?: unknown } | null;
  if (b?.action === "pair") {
    const problem = remoteProblem();
    if (problem) return Response.json({ error: problem }, { status: 503 });
    newPair(user.id);
  } else if (b?.action === "revoke" && typeof b.id === "string") {
    const id = b.id;
    await updateDevices((ds) => ds.filter((d) => d.id !== id));
    S.seen.delete(id); S.chat.delete(id);
  } else if (b?.action === "shortcut" && isShortcutAction(b.kind)) {
    const problem = remoteProblem();
    if (problem) return Response.json({ error: problem }, { status: 503 });
    const made = await createShortcut(user.id, b.kind, b.name);
    return Response.json({ ...(await view()), token: made.token, tokenFor: made.id });
  } else if (b?.action === "revokeShortcut" && typeof b.id === "string") {
    await revokeShortcut(b.id);
    S.seen.delete(`sc:${b.id}`); S.chat.delete(`sc:${b.id}`);
  } else return Response.json({ error: "action must be pair, revoke, shortcut or revokeShortcut" }, { status: 400 });
  return Response.json(await view());
}
