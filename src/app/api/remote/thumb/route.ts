import { readFile } from "node:fs/promises";
import { clipsDir } from "@/lib/clips/factory";
import { resolveInside } from "@/lib/clips/pure";
import { RATE } from "@/lib/remote-web-pure";
import { clipApprovals, deviceFromCookie, rateOk, remoteProblem } from "@/lib/remote";

export const dynamic = "force-dynamic";

// GET ?id=<approval id>: the thumbnail of a clip waiting for review, for the paired phone only (device-token cookie).
// Only clips listed as waiting right now are served, so the id can't reach any other file.
export async function GET(req: Request) {
  if (remoteProblem()) return new Response(null, { status: 503 });
  const device = await deviceFromCookie();
  if (!device) return new Response(null, { status: 401 });
  if (!rateOk(`thumb:${device.id}`, RATE.thumb)) return new Response(null, { status: 429 });
  const id = new URL(req.url).searchParams.get("id");
  const clip = (await clipApprovals()).find((a) => a.id === id);
  const abs = clip?.thumbPath?.startsWith("clips/") ? resolveInside(clipsDir(), clip.thumbPath.slice(6)) : null;
  const data = abs && /\.jpe?g$/i.test(abs) ? await readFile(abs).catch(() => null) : null;
  if (!data) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(data), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
