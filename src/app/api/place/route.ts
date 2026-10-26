import { requireUser } from "@/lib/supabase/server";
import { readPlace, updatePlace } from "@/lib/place";
import { currentPoint, MAX_PLACES, nearestPlace, parsePlaces, placeName, type PlaceState } from "@/lib/place-pure";

export const dynamic = "force-dynamic";

// Profile → Location-aware brief (opt-in, off by default). GET: {on, places, last: {at, near} | null}; the latest point's coordinates
// stay on disk. POST {on} switches it (off deletes the point) · {places} replaces the saved list · {saveHere: name, pc?} saves the
// phone's latest point as a named place. DELETE: forget the latest point now.
const view = (s: PlaceState) => {
  const p = currentPoint(s, Date.now());
  return { on: s.on, places: s.places, last: s.last ? { at: s.last.at, near: p ? nearestPlace(p, s.places)?.name ?? null : null } : null };
};
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json(view(await readPlace()));
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as { on?: unknown; places?: unknown; saveHere?: unknown; pc?: unknown } | null;
  if (typeof b?.on === "boolean") return Response.json(view(await updatePlace((s) => ({ ...s, on: b.on as boolean }))));
  if (b?.places !== undefined) {
    const p = parsePlaces(b.places);
    if (!p.ok) return fail(p.error);
    return Response.json(view(await updatePlace((s) => ({ ...s, places: p.places }))));
  }
  if (b?.saveHere !== undefined) {
    const name = placeName(b.saveHere);
    if (!name) return fail("Give the place a name");
    const s = await readPlace();
    if (!s.on || !s.last) return fail("No location from the phone yet: tap Update place on the phone first");
    if (s.places.length >= MAX_PLACES && !s.places.some((x) => x.name.toLowerCase() === name.toLowerCase())) return fail(`At most ${MAX_PLACES} places`);
    const pc = b.pc === true;
    return Response.json(view(await updatePlace((cur) => ({ ...cur, places: [
      ...cur.places.filter((x) => x.name.toLowerCase() !== name.toLowerCase()).map((x) => (pc ? { ...x, pc: undefined } : x)),
      { name, lat: s.last!.lat, lon: s.last!.lon, ...(pc && { pc: true }) },
    ] }))));
  }
  return fail("Expected on, places or saveHere");
}

export async function DELETE() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json(view(await updatePlace((s) => ({ on: s.on, places: s.places }))));
}
