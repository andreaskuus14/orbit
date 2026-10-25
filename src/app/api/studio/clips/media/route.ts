import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { requireUser } from "@/lib/supabase/server";
import { clipsDir } from "@/lib/clips/factory";
import { parseByteRange, resolveInside } from "@/lib/clips/pure";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" }; // png/webp: AI Story character previews

// Streams a rendered clip or thumbnail. ?f= is a Clip.video/thumb path ("clips/<job>/<file>"); only files under clips/ are served.
// Range support lets <video> seek.
export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const f = new URL(req.url).searchParams.get("f") ?? "";
  const abs = f.startsWith("clips/") ? resolveInside(clipsDir(), f.slice(6)) : null;
  const type = abs && TYPES[path.extname(abs).toLowerCase()];
  if (!abs || !type) return Response.json({ error: "Invalid file" }, { status: 400 });
  const s = await stat(abs).catch(() => null);
  if (!s?.isFile()) return Response.json({ error: "Not found" }, { status: 404 });
  const headers: Record<string, string> = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "private, no-cache" };
  const r = parseByteRange(req.headers.get("range"), s.size);
  if (r === "bad") return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${s.size}` } });
  const { start, end } = r ?? { start: 0, end: s.size - 1 };
  const body = s.size ? (Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream) : null;
  headers["Content-Length"] = String(s.size ? end - start + 1 : 0);
  if (r) headers["Content-Range"] = `bytes ${start}-${end}/${s.size}`;
  return new Response(body, { status: r ? 206 : 200, headers });
}
