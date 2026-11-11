import path from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { readState, saveState, studioRoot, withJobLock } from "@/lib/clips/factory";
import { STAGES, advance, approve, newTrack, revise, submit, summary, trackProblem, type StageId, type Track } from "@/lib/clips/track-pure";

// STUDIO Production track (Y2, track-pure.ts). GET = every track with its one-page state; POST { action, ... } = his clicks.
// Nothing here spends or publishes: paid generation is AI Story's story.approve, publishing is the Clip Factory publish click.
const dir = () => path.join(studioRoot(), "tracks");
const isId = (x: unknown): x is string => typeof x === "string" && /^[a-z0-9]{6,12}-[a-f0-9]{6}$/.test(x);
const get = (id: string) => readState<Track>(dir(), id, trackProblem);
const save = (t: Track) => saveState(t.id, path.join(dir(), `${t.id}.json`), t);

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  await mkdir(dir(), { recursive: true });
  const ids = (await readdir(dir())).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)).filter(isId);
  const tracks = (await Promise.all(ids.map(get))).filter((t): t is Track => !!t).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return Response.json({ stages: STAGES, tracks: await Promise.all(tracks.map(async (t) => ({ track: t, state: await summary(t) }))) });
}

export async function POST(req: Request) {
  const h = req.headers;
  if (crossSiteBlocked("POST", "/api/studio/track", { secFetchSite: h.get("sec-fetch-site"), origin: h.get("origin"), host: h.get("host"), forwardedHost: h.get("x-forwarded-host") }))
    return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "Bad request" }, { status: 400 });
  const at = new Date().toISOString();
  return withJobLock(async () => {
    if (b.action === "create") {
      if (typeof b.title !== "string" || b.title.trim().length < 2) return Response.json({ error: "Title required" }, { status: 400 });
      const t = newTrack(`${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`, b.title, at);
      await mkdir(dir(), { recursive: true }); await save(t);
      return Response.json({ track: t });
    }
    if (!isId(b.id)) return Response.json({ error: "Track id required" }, { status: 400 });
    const t = await get(b.id);
    if (!t) return Response.json({ error: "Track not found" }, { status: 404 });
    const stage = b.stage as StageId;
    const why = b.action === "submit" ? submit(t, stage, { ref: b.ref, note: b.note, sec: b.sec }, at)
      : b.action === "approve" ? await approve(t, stage, String(b.ref ?? ""), b.hash, at)
      : b.action === "advance" ? await advance(t)
      : b.action === "revise" ? revise(t) : "Unknown action";
    if (why) return Response.json({ error: why }, { status: 409 });
    await save(t);
    return Response.json({ track: t, state: await summary(t) });
  });
}
