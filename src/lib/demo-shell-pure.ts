// Public demo (/demo) runtime: the fetch guard and CORE's scripted answers. Ships to the browser, so it must stay free of
// fixtures for LIFE, journal, BUSINESS or anything owner-shaped: the page passes in only the DEMO_ROUTES responses.

export const DEMO_NOTE = "This is a demo — the real ORBIT runs privately.";
export const DEMO_WORLDS = ["studio", "intelligence", "memory", "arch"] as const;
export type DemoWorld = (typeof DEMO_WORLDS)[number];

/** The only requests the demo answers, all from fixtures ("METHOD path" -> demoFor endpoint). Everything else is refused. */
export const DEMO_ROUTES: Readonly<Record<string, string>> = {
  "GET /api/memories/map": "/api/memories/map",
  "GET /api/news/geo": "/api/news/geo",
  "GET /api/studio": "/api/studio",
  "GET /api/studio/clips": "/api/studio/clips",
  "GET /api/studio/clips/learn": "/api/studio/clips/learn",
  "POST /api/arch": "/api/arch", // ARCH's "build" answers with the canned garden plot: no model call
};

export type DemoData = Record<string, unknown>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fetch that never lets /api/* or another origin reach the network: fixture routes are answered in the page,
 *  the rest get a calm 403. Same-origin static files (scripts, textures) pass through to `real`. */
export function guardFetch(data: DemoData, real: typeof fetch, origin: string, blocked: string[] = []): typeof fetch {
  return async (input, init) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input), origin);
    const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
    const key = `${method} ${url.pathname}`;
    if (url.origin === origin && !/^\/api(\/|$)/i.test(url.pathname)) return real(input, init);
    if (url.origin === origin && Object.hasOwn(data, key)) return json(structuredClone(data[key]));
    blocked.push(url.origin === origin ? key : `${method} ${url.href}`);
    return json({ error: DEMO_NOTE }, 403);
  };
}

/** Patches window.fetch and navigator.sendBeacon once. Returns the list of refused requests (for the console). */
export function installDemoGuard(w: Window & typeof globalThis, data: DemoData): string[] {
  const g = w as unknown as { __orbitDemoBlocked?: string[] };
  if (g.__orbitDemoBlocked) return g.__orbitDemoBlocked;
  const blocked: string[] = (g.__orbitDemoBlocked = []);
  w.fetch = guardFetch(data, w.fetch.bind(w), w.location.origin, blocked);
  if (w.navigator.sendBeacon) w.navigator.sendBeacon = (url) => { blocked.push(`BEACON ${String(url)}`); return true; };
  return blocked;
}

const ANSWERS: [RegExp, string][] = [
  [/\b(what|who)\b.*\b(orbit|you)\b|\bhello\b|\bhi\b/i, "I'm CORE, the centre of ORBIT: a personal AI workspace drawn as a galaxy. Each planet is a world — STUDIO for video, INTELLIGENCE for news, MEMORY for notes, ARCH for building ideas."],
  [/\bmemor/i, "MEMORY turns notes into a constellation: similar ideas sit close together and linked notes share a thread. The stars here are a fictional lantern-garden notebook."],
  [/\bstudio|video|clip|short/i, "STUDIO tracks a channel's videos and clips and learns what keeps viewers watching. The channel in this demo is invented."],
  [/\bnews|intelligence|globe|world\b/i, "INTELLIGENCE pins stories on a globe so you can see where things are happening. The headlines in this demo are made up."],
  [/\barch|build|design|house/i, "ARCH sketches small buildings and sites in 3D from a sentence. Try the build box in the ARCH world: it answers with a canned garden plot."],
  [/\bprivate|privacy|data|real|log ?in|account/i, "Nothing you do here leaves this page. The real ORBIT runs privately on its owner's own computer; this demo uses invented sample data only."],
];
export const DEMO_PROMPTS = ["What is ORBIT?", "How does MEMORY work?", "Is my data sent anywhere?"];

/** CORE in the demo: scripted answers, no model call. */
export function coreReply(text: string): string {
  return ANSWERS.find(([re]) => re.test(text))?.[1]
    ?? "In the demo I can only give scripted answers. Ask about ORBIT, MEMORY, STUDIO, INTELLIGENCE, ARCH or privacy — or open a world below.";
}
