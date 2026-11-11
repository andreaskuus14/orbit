import { beacon } from "@/lib/pitch-links";

export const dynamic = "force-dynamic";

// Seconds-on-page beat from the viewer page (navigator.sendBeacon, text/plain JSON {v, s}). Rate-limited per link + /24.
type Ctx = { params: Promise<{ token: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { token } = await params;
  const raw = await req.text().catch(() => "");
  if (raw.length > 200) return new Response(null, { status: 413 });
  let b: { v?: unknown; s?: unknown } = {};
  try { b = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
  const ok = await beacon(token, b?.v, b?.s, req.headers.get("x-forwarded-for")).catch(() => false);
  return new Response(null, { status: ok ? 204 : 429 });
}
