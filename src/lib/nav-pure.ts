// CORE navigation: clear "go to / open / show me X" commands become a place in ORBIT without a model call.
// Pure (no DOM) — tested in tests/nav.test.ts. Anything that isn't plainly navigation returns null and goes to CORE.
import { COUNTRIES, REGIONS, displayName } from "./geo.ts";
import { WORLD } from "./countries-pure.ts";
import { planetById, type PanelId } from "./planets.ts";

/** panel null = back to the galaxy. country is a world-atlas name (as NewsGlobe uses), region a REGIONS key.
 *  view "none" closes STUDIO's overlay, "review" opens the clip factory's review queue; search runs the globe's news search ("" clears search and selection);
 *  zoom acts on whatever world is on screen and never navigates (panel is ignored). */
export type NavTarget = {
  panel: PanelId | null; country?: string; region?: string; view?: "stats" | "clips" | "review" | "none";
  search?: string; zoom?: "in" | "out" | "reset"; morning?: true; // morning: open the "Good morning" card on the galaxy and read it aloud
  doctor?: true; // doctor: open the ORBIT doctor (health checks) and read the result aloud; stays where you are
  beliefs?: true; // beliefs: MEMORY opens "What ORBIT believes"
  stopAll?: true; voice?: boolean; // direct actions: stay in the current world; voice sets output on/off
  continueWork?: true; // open the unfinished-work list, without starting or resuming a task
  life?: LifeView; start?: true; // life: LIFE opens on that tab; start (with life "focus"): start the focus timer
};
export type LifeView = "today" | "habits" | "focus" | "reminders" | "journal";
export const NAV_EVENT = "orbit:navigate"; // detail: NavTarget
/** "local news" means this country. */
export const LOCAL_COUNTRY = "Estonia";

const norm = (s: string) => s.toLowerCase().replace(/['’.]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Whole utterances only. Keep actions separate from PLACES so a model's navigate tool cannot stop work or unmute.
const INSTANT: Record<string, Omit<NavTarget, "panel">> = {};
const command = (action: Omit<NavTarget, "panel">, names: string) => names.split(",").forEach((n) => { INSTANT[n.trim()] = action; });
// Plain "stop" / "peata" only silences ORBIT's voice (STOP_WORDS): Stop-all cancels running agent work, so it needs the explicit phrase.
command({ stopAll: true }, "stop everything, stop all, peata kõik");
command({ voice: false }, "mute, vaigista");
command({ voice: true }, "unmute, lülita heli sisse");
command({ morning: true }, "status report, olukord");
command({ continueWork: true }, "show my work, continue my work, näita minu tööd, jätka minu tööd");
command({}, "back, galaxy, tagasi, galaktika");

const PLACES: Record<string, NavTarget> = {};
const put = (t: NavTarget, names: string) => names.split(",").forEach((n) => { PLACES[n.trim()] = t; });
put({ panel: null }, "galaxy, home, back, the galaxy, main screen, overview, start");
put({ panel: "core" }, "core");
put({ panel: "profile" }, "profile, my profile");
put({ panel: "memory" }, "memory, memories, my memories, notes, my notes, second brain, my second brain, brain");
put({ panel: "intelligence" }, "intelligence, news, the news, world news, latest news, globe, the globe, news globe, world pulse, headlines, pulse");
put({ panel: "operations" }, "operations, ops, tasks, my tasks, automations, my automations, projects");
put({ panel: "agents" }, "agents, my agents, ai agents, workforce, agents station, agent station, the agents station, station, the station");
put({ panel: "analytics" }, "analytics, usage, ai usage, my usage, activity");
put({ panel: "studio" }, "studio, youtube, youtube studio");
put({ panel: "arch" }, "arch, architecture, building design, house design, my house, construction, ehitus, arhitektuur");
put({ panel: "business" }, "business, my business, clients, my clients, pipeline, sales pipeline, prospects, leads");
put({ panel: "markets" }, "markets, market, stocks, stock market, my stocks, watchlist, my watchlist, portfolio, my portfolio, paper trading, investing");
put({ panel: "theater" }, "theater, theatre, cinema, movie theater, watch, watch videos, the big screen, big screen");
put({ panel: "studio", view: "none" }, "channel, my channel, youtube channel, my videos"); // the channel itself, overlays closed
put({ panel: "creation" }, "creation, game dev, gamedev, game development, games, my games, game lab, dev world, planet forge");
put({ panel: "life" }, "life, calendar");
// LIFE tabs: also accepted as a bare message ("journal", "focus timer"), like "good morning".
put({ panel: "life", life: "habits" }, "habits, my habits");
put({ panel: "life", life: "reminders" }, "reminders, my reminders");
put({ panel: "life", life: "focus" }, "focus timer, the focus timer, my focus timer, focus mode, pomodoro, pomodoro timer");
put({ panel: "life", life: "journal" }, "journal, my journal");
const START_FOCUS = /^(?:start|begin)(?: (?:a|the|my))? (?:focus(?:ing)?|pomodoro)(?: (?:timer|mode|session))?$/;
put({ panel: "vault" }, "vault, files, my files, file vault, documents, my documents");
// "my analytics" is the channel; plain "analytics" is the ANALYTICS planet (AI usage).
put({ panel: "studio", view: "stats" }, "stats, my stats, statistics, stats in the studio, stats of the studio, the stats of the studio, stats of the soda, the stats of the soda, statistics in the studio, channel stats, youtube stats, video stats, studio stats, my analytics, channel analytics, youtube analytics");
put({ panel: "studio", view: "clips" }, "clips, my clips, clip factory, the clip factory, clip maker, shorts, studio clips, clips in the studio, clips in studio, clips of the studio, the clips of the studio, clips of the soda, the clips in the studio, eclipse, eclipses, the eclipse, the eclipses");
put({ panel: "studio", view: "review" }, "review, the review, morning review, clip review, clips review, review queue, review clips, review my clips, review the clips, review new clips, review new");
put({ panel: null, morning: true }, "good morning, morning briefing, my morning briefing, morning brief, daily briefing, my daily briefing, daily brief, whats new today, brief me, morning card");
put({ panel: "memory", beliefs: true }, "what do you know about me, what you know about me, what does orbit know about me, what orbit knows about me, what do you believe about me, what does orbit believe, what orbit believes, what orbit believes about me");
put({ panel: null, doctor: true }, "check orbit, check on orbit, orbit doctor, doctor, the doctor, run diagnostics, run a diagnostic, run diagnostic, diagnostics, run the diagnostics, is everything working, is everything ok, is everything okay, is everything alright, system check, run a system check, health check, run a health check, check everything, check the system");

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
// Every other country by name too (Malta, Singapore, Laos…): the globe can open any of them.
for (const c of WORLD) for (const a of [c.name, displayName(c.name)]) if (!COUNTRY_ALIAS.has(norm(a))) COUNTRY_ALIAS.set(norm(a), c.name);

const AMBIGUOUS = new Set(["chad", "jordan", "georgia", "turkey", "china", "guinea", "niger", "togo", "dominica", "chile"]);
function place(x: string, news: boolean): NavTarget | null {
  x = x.replace(/^the /, "");
  if (news && /^(?:local|home|here|my country)$/.test(x)) return { panel: "intelligence", country: LOCAL_COUNTRY };
  if (REGION_ALIAS[x]) return { panel: "intelligence", region: REGION_ALIAS[x] };
  // Names that are also people, foods or US states only count with a news word or on the globe ("Jordan news").
  if (!news && AMBIGUOUS.has(x)) return null;
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
  const said = SUFFIX.exec(s)?.[0] ?? "";
  s = s.replace(SUFFIX, "");
  if (Object.hasOwn(INSTANT, s)) {
    const action = INSTANT[s];
    return { panel: action.stopAll || action.voice !== undefined ? ctx.current ?? null : null, ...action };
  }
  // "check orbit": SUFFIX ate the "orbit" that this phrase needs
  const doc = PLACES[s]?.doctor ? PLACES[s] : / orbit\b/.test(said) && PLACES[`${s} orbit`]?.doctor ? PLACES[`${s} orbit`] : null;
  if (doc) return doc;
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
  if (s !== "review" && PLACES[s]?.view === "review") return PLACES[s]; // "morning review", "review my clips": commands without a verb
  if (START_FOCUS.test(s)) return { panel: "life", life: "focus", start: true }; // "start focus", "start a pomodoro"
  if (PLACES[s]?.morning || PLACES[s]?.beliefs || (PLACES[s]?.life && ctx.current !== "core")) return PLACES[s]; // in CORE a bare "journal" may answer its question // "good morning", "brief me", "what do you know about me"
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
  if ((input.view === "stats" || input.view === "clips" || input.view === "review" || input.view === "none") && (!dest || dest.panel === "studio")) return { panel: "studio", view: input.view };
  return dest;
}

/** "Intelligence → Estonia", "Studio → Stats", "the galaxy". */
export function navLabel(t: NavTarget): string {
  if (t.stopAll) return "Stop-all";
  if (t.voice !== undefined) return "voice output";
  if (t.continueWork) return "Continue my work";
  if (t.morning) return "your morning briefing";
  if (t.doctor) return "the ORBIT doctor";
  if (t.beliefs) return "what ORBIT believes";
  if (!t.panel) return "the galaxy";
  const name = t.panel === "core" ? "CORE" : t.panel === "profile" ? "your profile" : planetById(t.panel)!.name.charAt(0) + planetById(t.panel)!.name.slice(1).toLowerCase();
  const sub = t.country ? displayName(t.country) : t.region ?? (t.view === "stats" ? "Stats" : t.view === "clips" ? "Clips" : t.view === "review" ? "Clip review" : t.life ? t.life.charAt(0).toUpperCase() + t.life.slice(1) : "");
  return sub ? `${name} → ${sub}` : name;
}
export const navReply = (t: NavTarget) =>
  t.stopAll ? "Stop-all is on; background work is paused."
    : t.voice !== undefined ? (t.voice ? "Voice output on." : "Voice output muted.")
    : t.continueWork ? "Here's your unfinished work."
    : t.morning ? "Here's your morning briefing."
    : t.doctor ? "Checking everything. One moment."
    : t.beliefs ? "Here's what I know about you."
    : t.zoom ? (t.zoom === "reset" ? "Resetting the view." : `Zooming ${t.zoom}.`)
    : t.search ? `Searching the news for “${t.search}”.`
    : t.search === "" ? "Showing the whole world."
    : t.view === "none" ? "Here's your channel."
    : t.start ? "Focus timer on." // may already be running (or on a break): the panel decides
    : `Flying to ${navLabel(t)}.`;
