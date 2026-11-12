import path from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { requireUser } from "@/lib/supabase/server";
import { crossSiteBlocked } from "@/lib/csrf";
import { readState, saveState, studioRoot, withJobLock } from "@/lib/clips/factory";
import { fileSha, generateForTrack, refreshShas } from "@/lib/clips/track";
import { STAGES, advance, approve, newTrack, revise, submit, summary, trackProblem, type StageId, type Track } from "@/lib/clips/track-pure";

// STUDIO Production track (Y2, track-pure.ts). GET = every track with its one-page state; POST { action, ... } = his clicks.
// generate = his click on an AI Story quote (seen hash), through approveStory's guards; publishing stays the Clip Factory publish click.
const dir = () => path.join(studioRoot(), "tracks");
const isId = (x: unknown): x is string => typeof x === "string" && /^[a-z0-9]{6,12}-[a-f0-9]{6}$/.test(x);
const get = async (id: string) => { const t = await readState<Track>(dir(), id, trackProblem); if (t) await refreshShas(t); return t; };
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
    if (b.action === "generate") {
      const r = await generateForTrack(t, stage, String(b.story ?? ""), b.credits, b.seen, Array.isArray(b.frames) ? b.frames.map(String) : []);
      if ("error" in r) return Response.json({ error: r.error }, { status: 409 });
      await save(t);
      return Response.json({ track: t, state: await summary(t) });
    }
    const why = b.action === "submit" ? submit(t, stage, { ref: b.ref, sha: typeof b.ref === "string" ? await fileSha(b.ref.trim()) : "", note: b.note, sec: b.sec }, at)
      : b.action === "approve" ? await approve(t, stage, String(b.ref ?? ""), b.hash, at)
      : b.action === "advance" ? await advance(t)
      : b.action === "revise" ? revise(t) : "Unknown action";
    if (why) return Response.json({ error: why }, { status: 409 });
    await save(t);
    return Response.json({ track: t, state: await summary(t) });
  });
}
