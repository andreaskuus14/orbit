import { requireUser } from "@/lib/supabase/server";
import { muteTwin, twinMuted, twinView } from "@/lib/twin";

export const dynamic = "force-dynamic";
const fail = (e: unknown) => Response.json({ error: e instanceof Error ? e.message : "Twin failed" }, { status: 500 });

/** Muted kinds ("don't argue on this kind"). */
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  try { return Response.json({ muted: await twinMuted() }); } catch (e) { return fail(e); }
}

/** {decision:{kind, ref, title, detail?, credits?, cap?, from?, to?}} → {view} (null = stays quiet) | {action:"mute", kind, muted}. */
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    if (b?.action === "mute") {
      const err = await muteTwin(sb, user.id, b.kind, b.muted);
      return err ? Response.json({ error: err }, { status: 400 }) : Response.json({ muted: await twinMuted() });
    }
    const v = await twinView(sb, user.id, b?.decision);
    return typeof v === "string" ? Response.json({ error: v }, { status: 400 }) : Response.json({ view: v });
  } catch (e) { return fail(e); }
}
