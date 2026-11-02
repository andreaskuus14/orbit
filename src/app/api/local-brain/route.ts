import { requireUser } from "@/lib/supabase/server";
import { localBrainHealth } from "@/lib/local-llm";
import { autostartState, setAutostart } from "@/lib/autostart";

export const dynamic = "force-dynamic";

// OPERATIONS → Local AI, "This PC" rows. GET → { brain: local brain health (+ private: journal help on), autostart }.
// POST { autostart: true|false } → the owner's click: registers or removes the per-user "ORBIT" sign-in task.
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  const [brain, autostart] = await Promise.all([localBrainHealth(), autostartState()]);
  return Response.json({ brain, autostart }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { autostart?: unknown } | null;
  if (typeof b?.autostart !== "boolean") return Response.json({ error: "autostart must be true or false" }, { status: 400 });
  return Response.json({ autostart: await setAutostart(b.autostart) });
}
