// CORE navigation: clear "go to / open / show me X" commands become a place in ORBIT without a model call.
// Pure (no DOM) — tested in tests/nav.test.ts. Anything that isn't plainly navigation returns null and goes to CORE.
import { COUNTRIES, REGIONS, displayName } from "./geo.ts";
import { planetById, type PanelId } from "./planets.ts";

/** panel null = back to the galaxy. country is a world-atlas name (as NewsGlobe uses), region a REGIONS key. */
export type NavTarget = { panel: PanelId | null; country?: string; region?: string; view?: "stats" | "clips" };
export const NAV_EVENT = "orbit:navigate"; // detail: NavTarget
/** "local news" means this country. */
export const LOCAL_COUNTRY = "Estonia";

const norm = (s: string) => s.toLowerCase().replace(/['’.]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const PLACES: Record<string, NavTarget> = {};
const put = (t: NavTarget, names: string) => names.split(",").forEach((n) => { PLACES[n.trim()] = t; });
put({ panel: null }, "galaxy, home, back, the galaxy, main screen, overview, start");
put({ panel: "core" }, "core");
put({ panel: "profile" }, "profile, my profile");
put({ panel: "memory" }, "memory, memories, my memories, notes, my notes, second brain, my second brain, brain");
put({ panel: "intelligence" }, "intelligence, news, the news, world news, latest news, globe, the globe, news globe, world pulse, headlines, pulse");
put({ panel: "operations" }, "operations, ops, tasks, my tasks, automations, my automations, projects");
put({ panel: "agents" }, "agents, my agents, ai agents, workforce");
put({ panel: "analytics" }, "analytics, usage, ai usage, my usage, activity");
put({ panel: "studio" }, "studio, youtube, youtube studio, channel, my channel, youtube channel");
put({ panel: "creation" }, "creation, game dev, gamedev, game development, games, my games, game lab, dev world, planet forge");
put({ panel: "life" }, "life, calendar, habits");
put({ panel: "vault" }, "vault, files");
// "my analytics" is the channel; plain "analytics" is the ANALYTICS planet (AI usage).
put({ panel: "studio", view: "stats" }, "stats, my stats, statistics, channel stats, youtube stats, video stats, studio stats, my analytics, channel analytics, youtube analytics");
put({ panel: "studio", view: "clips" }, "clips, my clips, clip factory, the clip factory, clip maker, shorts");

const REGION_ALIAS: Record<string, string> = {
  "north america": "Americas", "south america": "Americas", "latin america": "Americas", mideast: "Middle East",
  european: "Europe", african: "Africa", asian: "Asia", "middle eastern": "Middle East",
};
for (const r of Object.keys(REGIONS)) REGION_ALIAS[norm(r)] = r;
// Name, display name and every gazetteer term ("USA", "Britain", "German", "Tallinn"); first country wins a clash.
const COUNTRY_ALIAS = new Map<string, string>([["the states", "United States of America"], ["great britain", "United Kingdom"], ["holland", "Netherlands"]]);
for (const c of COUNTRIES) for (const a of [c.name, displayName(c.name), ...c.terms]) if (!COUNTRY_ALIAS.has(norm(a))) COUNTRY_ALIAS.set(norm(a), c.name);

function place(x: string, news: boolean): NavTarget | null {
  x = x.replace(/^the /, "");
  if (news && /^(?:local|home|here|my country)$/.test(x)) return { panel: "intelligence", country: LOCAL_COUNTRY };
  if (REGION_ALIAS[x]) return { panel: "intelligence", region: REGION_ALIAS[x] };
  const c = COUNTRY_ALIAS.get(x);
  return c ? { panel: "intelligence", country: c } : null;
}

/** A place name ("studio", "my stats", "news from Germany", "Europe news", "Estonia") → target, or null. */
function findPlace(r: string): NavTarget | null {
  const bare = r.replace(/^(?:the|my|our) /, "").replace(/ (?:planet|world|page|panel|view|screen|tab|section)$/, "");
  for (const x of [r, bare]) {
    if (PLACES[x]) return PLACES[x];
    const m = /^(?:latest |top )?(?:news|headlines|stories)(?: (?:in|from|about|for|of|on|out of))? (.+)$/.exec(x) ?? /^(.+?) (?:news|headlines|stories)$/.exec(x);
    const p = m ? place(m[1], true) : place(x, false);
    if (p) return p;
  }
  return null;
}

const PREFIX = /^(?:(?:(?:hey|hi|ok|okay|a) )?(?:orbit|orbits|core)|please|can you|could you|would you|will you|lets|let us|now|ok|okay|alright|all right|hey|hi|so|just|i want to|id like to|i would like to) /;
const SUFFIX = /(?: (?:please|now|for me|orbit|thanks|thank you))+$/;
const VERB = /^(?:(?:go|fly|head|jump|zoom|navigate|switch|move|return)(?: back| over| on)?(?: (?:to|into|over to))?|open(?: up)?|show(?: me| us)?|take (?:me|us)(?: back)?(?: (?:to|over to))?|bring(?: me| us)?(?: back)?(?: up| to)?|pull up|display|launch|visit|back to)(?: |$)/;

/** The whole message must be a navigation command ("show me news from Germany"); questions ("what's going on in Germany?") → null. */
export function parseNavCommand(text: string): NavTarget | null {
  let s = norm(text);
  for (let prev = ""; prev !== s;) { prev = s; s = s.replace(PREFIX, ""); }
  s = s.replace(SUFFIX, "");
  const v = VERB.exec(s);
  if (!v) return null;
  const rest = s.slice(v[0].length).trim();
  if (!rest) return /back|return/.test(v[0]) ? { panel: null } : null; // "go back", "take me back"
  return findPlace(rest);
}

/** CORE's navigate tool input, checked against the same allowlist. */
export function validateNav(input: Record<string, unknown>): NavTarget | null {
  const s = (v: unknown) => (typeof v === "string" ? norm(v.slice(0, 80)) : "");
  const where = s(input.country) ? place(s(input.country), true) : null;
  if (where) return where;
  if (input.view === "stats" || input.view === "clips") return { panel: "studio", view: input.view };
  return s(input.target) ? findPlace(s(input.target)) : null;
}

/** "Intelligence → Estonia", "Studio → Stats", "the galaxy". */
export function navLabel(t: NavTarget): string {
  if (!t.panel) return "the galaxy";
  const name = t.panel === "core" ? "CORE" : t.panel === "profile" ? "your profile" : planetById(t.panel)!.name.charAt(0) + planetById(t.panel)!.name.slice(1).toLowerCase();
  const sub = t.country ? displayName(t.country) : t.region ?? (t.view === "stats" ? "Stats" : t.view === "clips" ? "Clips" : "");
  return sub ? `${name} → ${sub}` : name;
}
export const navReply = (t: NavTarget) => `Flying to ${navLabel(t)}.`;
