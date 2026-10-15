// CORE navigation: clear "go to / open / show me X" commands become a place in ORBIT without a model call.
// Pure (no DOM) — tested in tests/nav.test.ts. Anything that isn't plainly navigation returns null and goes to CORE.
import { COUNTRIES, REGIONS, displayName } from "./geo.ts";
import { planetById, type PanelId } from "./planets.ts";

/** panel null = back to the galaxy. country is a world-atlas name (as NewsGlobe uses), region a REGIONS key.
 *  view "none" closes STUDIO's overlay; search runs the globe's news search ("" clears search and selection);
 *  zoom acts on whatever world is on screen and never navigates (panel is ignored). */
export type NavTarget = {
  panel: PanelId | null; country?: string; region?: string; view?: "stats" | "clips" | "none";
  search?: string; zoom?: "in" | "out" | "reset";
};
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
put({ panel: "studio" }, "studio, youtube, youtube studio");
put({ panel: "studio", view: "none" }, "channel, my channel, youtube channel, my videos"); // the channel itself, overlays closed
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
// Name, display name, abbreviations ("USA") and demonyms ("German"); NOT the gazetteer's cities/institutions
// ("White House", "Florida"), so "show me news about the White House" stays a CORE question. First country wins a clash.
const COUNTRY_ALIAS = new Map<string, string>([["the states", "United States of America"], ["america", "United States of America"],
  ["great britain", "United Kingdom"], ["britain", "United Kingdom"], ["british", "United Kingdom"], ["england", "United Kingdom"], ["holland", "Netherlands"]]);
for (const c of COUNTRIES) {
  const stems = [c.name, displayName(c.name)].map((n) => norm(n).slice(0, 4));
  const ok = (t: string) => /^[A-Z.]{2,5}$/.test(t) || stems.includes(norm(t).slice(0, 4));
  for (const a of [c.name, displayName(c.name), ...c.terms.filter(ok)]) if (!COUNTRY_ALIAS.has(norm(a))) COUNTRY_ALIAS.set(norm(a), c.name);
}

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

const PREFIX = /^(?:(?:(?:hey|hi|ok|okay|a) )?(?:orbit|orbits|orbital|core)|please|can you|could you|would you|will you|now|ok|okay|alright|all right|hey|hi|so|just|um|uh|er|hmm|yeah|yes) /; // no "i want to"/"lets": "let's go to Japan" is travel talk, not navigation
const SUFFIX = /(?: (?:please|now|for me|orbit|thanks|thank you))+$/;
const VERB = /^(?:zoom in(?:to| on)|(?:go|fly|head|jump|zoom|navigate|switch|move|return)(?: back| over| on| straight| right)?(?: (?:to|into|over to))?|open(?: up)?|show(?: me| us)?|take (?:me|us)(?: back)?(?: (?:to|over to))?|bring(?: me| us)?(?: back)?(?: up| to)?|pull up|display|launch|visit|back to)(?: |$)/;

const ZOOM_RESET = /^(?:reset(?: the)? (?:view|camera|zoom)|zoom (?:out )?all the way(?: out)?)$/;
const ZOOM = /^(?:zoom (in|out)(?: (?:more|a bit|a little|a lot|some|further|again))*|(?:(?:get|come|move|go) )?(closer)|(?:(?:go|move) )?(?:further|farther)(?: (?:out|away|back))?)$/;
const CLEAR = /^(?:clear(?: the)? search|(?:go )?back to the (?:world )?map|(?:show|go back to|back to)(?: me| us)? the (?:whole|entire) (?:world|globe|map)|show(?: me)? the world map|reset(?: the)? (?:globe|map))$/;
// "search (news) for X", "find/show me news about X", "look up X news"; X = "my memories…", "google…" stays with CORE.
const SEARCH = /^search(?: (?:the )?(?:news|headlines))?(?: (?:for|about|on))? (.+)$|^(?:find|show|get|give|pull up|bring up|open)(?: me| us)?(?: (?:the|some))? (?:latest |recent )?(?:news|headlines|stories) (?:about|on|regarding|for) (.+)$|^look up (.+) news$/;
const NOT_NEWS = /^(?:my|our|me|in|through|google|youtube|reddit|online|web|the (?:web|internet)|memor\w*|notes?|how|what|why|where|who|when|which|is|are|can|do|does|did)\b/;
const FILLER = /^(?:it|this|that|these|those|something|anything|more|again|for|on|about|them|him|her|there)$/; // dictation fragments, not topics

/** "germany" → the country view, "ai chips" → a news search. */
function newsFor(x: string): NavTarget | null {
  x = x.replace(/ (?:news|headlines|stories)$/, "").trim();
  const p = place(x.replace(/^(?:in|from|of) /, ""), true);
  if (p) return p;
  return x.length < 2 || NOT_NEWS.test(x) || FILLER.test(x) ? null : { panel: "intelligence", search: x.slice(0, 80) };
}

/** Only what the open world understands: STUDIO's overlays by bare name, a bare country on the globe. */
function inWorld(s: string, here: PanelId | null): NavTarget | null {
  if (here === "studio") {
    if (/^(?:close|hide|exit|dismiss)(?: the| my)? (?:stats|statistics|analytics|clips|clip factory|overlay)$/.test(s)) return { panel: "studio", view: "none" };
    const x = s.replace(/^(?:open|show(?: me)?|go to)(?: the| my)? /, "").replace(/^(?:the|my) /, "");
    if (x === "analytics") return { panel: "studio", view: "stats" }; // in STUDIO this is the channel's, not AI usage
    if (PLACES[x]?.panel === "studio" && PLACES[x].view) return PLACES[x];
  }
  return here === "intelligence" && !PLACES[s] ? place(s, true) : null; // "home" stays the galaxy, not local news
}

/** The whole message must be a navigation command ("show me news from Germany"); questions ("what's going on in Germany?") → null.
 *  current = the open panel (null = galaxy): with it, zoom and bare in-world words ("stats", "Germany") count; without it, they go to CORE. */
export function parseNavCommand(text: string, ctx: { current?: PanelId | null } = {}): NavTarget | null {
  let s = norm(text);
  for (let prev = ""; prev !== s;) { prev = s; s = s.replace(PREFIX, ""); }
  s = s.replace(SUFFIX, "");
  if (ctx.current !== undefined) {
    const here = ctx.current;
    if (ZOOM_RESET.test(s)) return { panel: here, zoom: "reset" };
    const z = ZOOM.exec(s);
    if (z) return { panel: here, zoom: z[1] === "in" || z[2] ? "in" : "out" };
    const w = inWorld(s, here);
    if (w) return w;
    if (here === "intelligence") { const m = /^(?:news|headlines|stories) (?:about|on|regarding|for) (.+)$/.exec(s); if (m) return newsFor(m[1]); }
  }
  if (CLEAR.test(s)) return { panel: "intelligence", search: "" };
  const q = SEARCH.exec(s);
  if (q) {
    const x = q[1] ?? q[2] ?? q[3], t = newsFor(x);
    // A bare "search for X" is only news on the globe, for a place, or when X says "news"; elsewhere ("search for a good laptop") it's for CORE.
    const bare = q[1] !== undefined && !/^search (?:the )?(?:news|headlines)\b/.test(s);
    return !bare || ctx.current === "intelligence" || (t && !t.search) || / (?:news|headlines)$/.test(x) ? t : null;
  }
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
  if (input.zoom === "in" || input.zoom === "out" || input.zoom === "reset") return { panel: null, zoom: input.zoom };
  // Models fill optional fields with "" or defaults: let the target decide whether search/view apply at all.
  const dest = s(input.target) ? findPlace(s(input.target)) : null;
  if (s(input.search) && (!dest || dest.panel === "intelligence")) return newsFor(s(input.search));
  if (input.search === "" && (!dest || (dest.panel === "intelligence" && !dest.country && !dest.region))) return { panel: "intelligence", search: "" };
  if ((input.view === "stats" || input.view === "clips" || input.view === "none") && (!dest || dest.panel === "studio")) return { panel: "studio", view: input.view };
  return dest;
}

/** "Intelligence → Estonia", "Studio → Stats", "the galaxy". */
export function navLabel(t: NavTarget): string {
  if (!t.panel) return "the galaxy";
  const name = t.panel === "core" ? "CORE" : t.panel === "profile" ? "your profile" : planetById(t.panel)!.name.charAt(0) + planetById(t.panel)!.name.slice(1).toLowerCase();
  const sub = t.country ? displayName(t.country) : t.region ?? (t.view === "stats" ? "Stats" : t.view === "clips" ? "Clips" : "");
  return sub ? `${name} → ${sub}` : name;
}
export const navReply = (t: NavTarget) =>
  t.zoom ? (t.zoom === "reset" ? "Resetting the view." : `Zooming ${t.zoom}.`)
    : t.search ? `Searching the news for “${t.search}”.`
    : t.search === "" ? "Showing the whole world."
    : t.view === "none" ? "Here's your channel."
    : `Flying to ${navLabel(t)}.`;
