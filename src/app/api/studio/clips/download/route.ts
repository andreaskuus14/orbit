import { requireUser } from "@/lib/supabase/server";
import { startClipQueue, startDownload } from "@/lib/clips/factory";
import { cleanPermission, parseClipUrl, validOptions } from "@/lib/clips/pure";

export const dynamic = "force-dynamic";

// Add from link: yt-dlp downloads a YouTube/Twitch video into the inbox (optionally then makes clips). Contract: src/lib/clips/types.ts.
export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  startClipQueue();
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "JSON body required" }, { status: 400 });
  const url = parseClipUrl(b.url);
  if (!url) return Response.json({ error: "url must be an https YouTube or Twitch link" }, { status: 400 });
  const permission = cleanPermission(b.permission);
  if (permission === null) return Response.json({ error: "The permission note can be at most 300 characters" }, { status: 400 });
  let autoClip;
  if (b.autoClip !== undefined) {
    if (!b.autoClip || typeof b.autoClip !== "object") return Response.json({ error: "autoClip must be an object" }, { status: 400 });
    autoClip = validOptions(b.autoClip as Record<string, unknown>);
    if (typeof autoClip === "string") return Response.json({ error: autoClip }, { status: 400 });
  }
  const r = await startDownload(url, permission, autoClip);
  if ("error" in r) { const { status, ...body } = r; return Response.json(body, { status }); }
  return Response.json(r);
}
