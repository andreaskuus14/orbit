// Perf log, owner-only and in memory: the galaxy page's freeze log (frames over 150 ms, last 300), its fps meter
// (per-scene 10 s windows, last 30 min) and, with ?core=1, CORE stage timings per path. Timings and script names only.
import { requireUser } from "@/lib/supabase/server";
import { longFrames as log, sceneWindows, coreTurns } from "@/lib/perf-log";
import { cleanWindow, coreStats, rollupScenes } from "@/lib/perf-pure";

export const dynamic = "force-dynamic";
const SPAN = 30 * 60_000;

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => null);
  const items = Array.isArray(body?.items) ? body.items.slice(0, 50) : [];
  for (const it of items) if (JSON.stringify(it).length < 4000) log.push({ ...it, rx: Date.now() });
  log.splice(0, Math.max(0, log.length - 300));
  const frames = Array.isArray(body?.frames) ? body.frames.slice(0, 20) : [];
  const now = Date.now();
  for (const f of frames) { const w = cleanWindow(f, now); if (w) sceneWindows.push(w); }
  const old = sceneWindows.findIndex((w) => now - w.rx <= SPAN);
  sceneWindows.splice(0, old < 0 ? sceneWindows.length : old);
  sceneWindows.splice(0, Math.max(0, sceneWindows.length - 2000));
  return Response.json({ ok: true });
}

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  if (new URL(req.url).searchParams.get("core") === "1") return Response.json({ turns: coreTurns.length, paths: coreStats(coreTurns) });
  return Response.json({ items: log, scenes: rollupScenes(sceneWindows, Date.now(), SPAN) });
}
