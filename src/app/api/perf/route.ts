// Freeze log: the galaxy page reports frames over 150 ms (with what ran) so they can be diagnosed from another window.
// Owner-only, in memory, last 300 entries. Holds timings and script names only: no user content.
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const log: unknown[] = ((globalThis as { __orbitPerf?: unknown[] }).__orbitPerf ??= []);

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const body = await req.json().catch(() => null);
  const items = Array.isArray(body?.items) ? body.items.slice(0, 50) : [];
  for (const it of items) if (JSON.stringify(it).length < 4000) log.push({ ...it, rx: Date.now() });
  log.splice(0, Math.max(0, log.length - 300));
  return Response.json({ ok: true });
}

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json({ items: log });
}
