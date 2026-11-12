// School timetable (.ics) IO: kept locally in <data dir>/timetable.json, read-only, no Google sign-in. A feed URL goes through safeFetch
// (SSRF guard, size cap) and is re-read at most every 6 h; a failed refresh keeps the last good copy. Parsing: ics-pure.ts. No model call here.
import path from "node:path";
import { orbitDataDir } from "./data-dir.ts";
import { ICS_MAX_BYTES, icsEvents, looksLikeIcs } from "./ics-pure.ts";
import { readStore, writeStore } from "./safe-file.ts";
import type { CalEvent } from "./gcal-pure.ts";

type Saved = { text: string; at: number; url?: string };
const file = () => path.join(orbitDataDir(), "timetable.json");
const REFRESH_MS = 6 * 3600_000;
const load = async (): Promise<Saved | null> => { try { const j = JSON.parse(await readStore(file())); return typeof j?.text === "string" ? j : null; } catch { return null; } };

async function fetchText(raw: string): Promise<string> {
  const { safeFetch } = await import("./memory.ts");
  const { body } = await safeFetch(raw.trim().replace(/^webcal:/i, "https:"), "text/calendar,text/plain;q=0.9,*/*;q=0.5", undefined, ICS_MAX_BYTES);
  return new TextDecoder().decode(body);
}

/** Save an uploaded file's text, or fetch `url`. Returns an error text or the number of events found in the next 30 days. */
export async function importTimetable(src: { text?: string; url?: string }): Promise<string | { events: number }> {
  let text = src.text ?? "";
  try { if (src.url) text = await fetchText(src.url); } catch (e) { return `Couldn't read that link: ${e instanceof Error ? e.message : "failed"}`; }
  if (text.length > ICS_MAX_BYTES) return "That file is too big for a timetable (max 1 MB)";
  if (!looksLikeIcs(text)) return "That doesn't look like an .ics calendar file";
  await writeStore(file(), JSON.stringify({ text, at: Date.now(), ...(src.url && { url: src.url.trim() }) } satisfies Saved));
  const now = Date.now();
  return { events: icsEvents(text, now, now + 30 * 86_400_000).length };
}

export const removeTimetable = () => writeStore(file(), "");
export const timetableInfo = async () => { const s = await load(); return s ? { url: s.url ?? null } : null; };

/** Timetable events overlapping [from, to); [] when none is imported. */
export async function timetableEvents(from: number, to: number, now = Date.now()): Promise<CalEvent[]> {
  let s = await load();
  if (!s) return [];
  if (s.url && now - s.at > REFRESH_MS) {
    const r = await importTimetable({ url: s.url });
    if (typeof r !== "string") s = (await load()) ?? s;
    else await writeStore(file(), JSON.stringify({ ...s, at: now })); // failed: keep the old copy, but don't retry until the next window
  }
  return icsEvents(s.text, from, to);
}
