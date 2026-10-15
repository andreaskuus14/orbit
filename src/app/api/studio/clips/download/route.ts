import { requireUser } from "@/lib/supabase/server";
import { checkTools, createDownload, listDownloads, startClipQueue } from "@/lib/clips/factory";
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
  if (!permission) return Response.json({ error: "Note how the creator allows clipping (5-300 characters)" }, { status: 400 });
  let autoClip;
  if (b.autoClip !== undefined) {
    if (!b.autoClip || typeof b.autoClip !== "object") return Response.json({ error: "autoClip must be an object" }, { status: 400 });
    autoClip = validOptions(b.autoClip as Record<string, unknown>);
    if (typeof autoClip === "string") return Response.json({ error: autoClip }, { status: 400 });
  }
  const tools = await checkTools();
  if (!tools.ytdlp || !tools.ffmpeg) return Response.json({ error: !tools.ytdlp ? "yt-dlp is missing: winget install yt-dlp.yt-dlp" : "ffmpeg is missing", tools }, { status: 503 });
  const dup = (await listDownloads()).find((d) => d.url === url && (d.status === "queued" || d.status === "downloading"));
  if (dup) return Response.json({ error: "This link is already downloading", download: dup }, { status: 409 });
  return Response.json({ download: await createDownload(url, permission, autoClip) });
}
