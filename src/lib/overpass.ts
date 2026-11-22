// find_lead_candidates, IO side: ONE Overpass query per run (public area name + business types only, never private text), with a
// polite User-Agent, a timeout, a per-day cap and backoff on 429/504. Read-only: it returns candidates; saving a lead still goes
// through the existing check and save_lead / lead_create rules. Pure parts and tests: overpass-pure.ts, tests/overpass.test.ts.
import { safeFetch } from "./memory";
import { polite, Blocked, UA, hintFor } from "./reach/net";
import { stopAllOn } from "./stop-all";
import { ATTRIBUTION, OVERPASS_URL, FETCH_MAX, FETCH_TIMEOUT_MS, LIMIT_DEFAULT, backoffMs, buildQuery, candidatesText, dedupe, parseArea, parseOverpass, parseTypes, retryable, runBlocked, type RunState } from "./overpass-pure";

// shortcut: the run counter lives in memory (a restart resets it), like reach/net.ts.
const g = globalThis as unknown as { __orbitOverpass?: RunState };
const state = (g.__orbitOverpass ??= { day: "", n: 0, last: 0 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function queryOnce(q: string): Promise<unknown> {
  const url = `${OVERPASS_URL}?data=${encodeURIComponent(q)}`;
  for (let attempt = 1; ; attempt++) {
    try {
      return await polite(url, async () => {
        const { res } = await safeFetch(url, "application/json", `${UA} overpass-lead-finder`, 3_000_000, FETCH_TIMEOUT_MS);
        try { return JSON.parse(await res.text()) as unknown; } catch { throw new Blocked("answered with something other than JSON", 502); }
      });
    } catch (e) {
      const st = Number((e instanceof Error ? e.message : "").match(/answered (\d{3})/)?.[1]);
      const wait = st && retryable(st) ? backoffMs(attempt) : null;
      if (wait === null || stopAllOn()) throw st ? new Blocked(`answered ${st}`, st) : e;
      await sleep(wait);
    }
  }
}

/** The find_lead_candidates tool: {area, types?, limit?} → candidate text. `existing` = the BUSINESS prospects (name + notes) to skip. */
export async function runCandidatesTool(i: Record<string, unknown>, existing: { name: string; notes?: string | null }[]): Promise<string> {
  const area = parseArea(i.area);
  if (!area) return 'Error: area must be a city name like "Tallinn" or a bbox "south,west,north,east" (under about 4 square degrees)';
  const types = parseTypes(i.types);
  const limit = typeof i.limit === "number" ? i.limit : LIMIT_DEFAULT;
  const day = new Date().toLocaleDateString("en-CA"), why = runBlocked(state, day, Date.now());
  if (why) return `Error: ${why}`;
  if (stopAllOn()) return "Error: Stop-all is on";
  if (state.day !== day) { state.day = day; state.n = 0; }
  state.n++; state.last = Date.now(); // counted before the call: a failed query still used the server's time
  const label = area.kind === "name" ? area.name : "that area";
  try {
    const json = await queryOnce(buildQuery(area, types, FETCH_MAX));
    const remark = (json as { remark?: unknown })?.remark;
    const found = parseOverpass(json, area.kind === "name" ? area.name : "");
    if (!found.length && typeof remark === "string" && /error|timed out|out of memory/i.test(remark)) return `Error: OpenStreetMap's server could not finish the query (${remark.slice(0, 120)}). Try a smaller area or fewer types.\n${ATTRIBUTION}`;
    const picked = dedupe(found, existing, limit);
    return candidatesText(picked, label, found.length - picked.length);
  } catch (e) {
    return `Error: ${hintFor("OpenStreetMap (Overpass)", e)}`;
  }
}
