// Location-aware brief, server side: <data dir>/place.json holds the opt-in switch, his saved places and the ONE latest coarse
// point (no history). Never sent to Supabase or a model. Rules and lines: place-pure.ts; routes: /api/place (PC), /api/remote/place (phone).
// shortcut: one file for the whole install (ORBIT has one owner); key it by user id if a second account ever signs in.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import { OFF, parsePlaces, parsePoint, type PlaceState } from "./place-pure";

const file = () => path.join(orbitDataDir(), "place.json");

export async function readPlace(): Promise<PlaceState> {
  try {
    const j = JSON.parse(await readFile(file(), "utf8"));
    const places = parsePlaces(j?.places);
    const last = parsePoint(j?.last);
    return { on: j?.on === true, places: places.ok ? places.places : [], ...(j?.on === true && last && typeof j.last.at === "string" && { last: { ...last, at: j.last.at } }) };
  } catch { return OFF; }
}

let saving: Promise<unknown> = Promise.resolve();
/** Serialized read-modify-write, saved atomically (tmp + rename). Turning the switch off always drops the point. */
export function updatePlace(fn: (s: PlaceState) => PlaceState): Promise<PlaceState> {
  const p = saving.catch(() => {}).then(async () => {
    const n = fn(await readPlace());
    const next: PlaceState = n.on ? n : { on: false, places: n.places };
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(next));
    await rename(file() + ".tmp", file());
    return next;
  });
  saving = p;
  return p;
}
