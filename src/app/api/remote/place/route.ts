import { deviceFromCookie, rateOk, remoteProblem } from "@/lib/remote";
import { RATE } from "@/lib/remote-web-pure";
import { readPlace, updatePlace } from "@/lib/place";
import { nearestPlace, parsePoint } from "@/lib/place-pure";

export const dynamic = "force-dynamic";

// Phone side of the location-aware brief, paired device only. GET: {on}. POST {lat, lon}: only when he switched it on in Profile;
// rounded to ~1 km again here (the phone already rounds), replaces the one stored point, answers with the saved place it is near.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

async function paired() {
  const problem = remoteProblem();
  if (problem) return { res: fail(problem, 503) };
  const device = await deviceFromCookie();
  if (!device) return { res: fail("Not paired", 401) };
  if (!rateOk(`place:${device.id}`, RATE.cmd)) return { res: fail("Too many requests: wait a minute", 429) };
  return { device };
}

export async function GET() {
  const { device, res } = await paired();
  if (!device) return res;
  return Response.json({ on: (await readPlace()).on });
}

export async function POST(req: Request) {
  const { device, res } = await paired();
  if (!device) return res;
  const raw = await req.text().catch(() => "");
  if (raw.length > 256) return fail("Request too large", 413);
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { /* below */ }
  const p = parsePoint(body);
  if (!p) return fail("Expected {lat, lon}");
  if (!(await readPlace()).on) return fail("Location-aware brief is off: turn it on in Profile on the PC", 403);
  const s = await updatePlace((cur) => (cur.on ? { ...cur, last: { ...p, at: new Date().toISOString() } } : cur)); // switched off meanwhile → nothing saved
  return Response.json({ near: s.last ? nearestPlace(s.last, s.places)?.name ?? null : null });
}
