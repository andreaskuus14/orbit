// The phone app (/m), pure parts (node tests in tests/phone-pwa.test.ts): the install manifest, what the service worker may
// cache (the app shell only; never /api, journal/LIFE or any other data), the offline screen, where a Needs-you item opens on the
// phone, the quick links, and the briefing's top stories with their pictures.
// Keep this file free of non-erasable TS syntax (it runs under node --experimental-strip-types).
import { linkToHash } from "./deeplink-pure.ts";
import type { BriefOpen } from "./brief-pure.ts";
import type { Lang } from "./i18n-core-pure.ts";

export const PHONE_HOME = "/m";
export const PHONE_OFFLINE = "/m/__offline";
export const THEME = "#05070c"; // --pu-bg

export function phoneManifest() {
  return {
    id: PHONE_HOME, name: "ORBIT", short_name: "ORBIT", description: "Ask CORE, see what needs you and what ORBIT is working on.",
    start_url: PHONE_HOME, scope: "/", display: "standalone", orientation: "portrait", background_color: THEME, theme_color: THEME,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

/** Files the worker stores on the phone at install: the /m page and its icons. Data is never on this list. */
export const PRECACHE = [PHONE_HOME, "/icon-192.png", "/icon-512.png"];

/** "static": hashed build files and the app icons (cache first). "shell": the /m page (network first, the cached copy or the
 *  offline screen when the PC can't be reached). "api": goes to the PC live, never stored; offline it answers 503 {offline:true}.
 *  null: not touched (the browser handles it as if there were no worker). */
export function mSwRoute(method: string, path: string): "static" | "shell" | "api" | null {
  if (path.startsWith("/api/")) return "api";
  if (method !== "GET") return null;
  if (path.startsWith("/_next/static/")) return "static";
  if (path === "/icon-192.png" || path === "/icon-512.png" || path === "/icons/icon-maskable-512.png") return "static";
  if (path === PHONE_HOME || path === PHONE_HOME + "/") return "shell";
  return null;
}

const OFFLINE = {
  en: { title: "ORBIT is offline", text: "Your laptop may be asleep, or Tailscale is off. Wake the laptop and try again.", retry: "Try again" },
  et: { title: "ORBIT ei vasta", text: "Sülearvuti võib magada või Tailscale on väljas. Ärata arvuti ja proovi uuesti.", retry: "Proovi uuesti" },
} as const;

/** The offline screen: plain HTML with no data in it, made inside the worker (the PC can't serve it when it's off). */
export function offlineHtml(lang: Lang): string {
  const w = OFFLINE[lang === "et" ? "et" : "en"];
  return `<!doctype html><html lang="${lang === "et" ? "et" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="${THEME}"><title>${w.title}</title><style>
html,body{margin:0;height:100%;background:${THEME};color:#ecf0f7;font:16px/24px Inter,system-ui,sans-serif}
main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;
padding:calc(24px + env(safe-area-inset-top)) 24px calc(24px + env(safe-area-inset-bottom))}
img{width:96px;height:96px;border-radius:22px}h1{font-size:20px;line-height:28px;font-weight:600;margin:8px 0 0}
p{color:#a9b2c3;margin:0;max-width:320px}button{min-height:44px;min-width:44px;padding:0 20px;border-radius:10px;border:0;
background:#22d3ee;color:${THEME};font:600 16px Inter,system-ui,sans-serif;margin-top:8px}</style></head>
<body><main><img src="/icon-192.png" alt=""><h1>${w.title}</h1><p>${w.text}</p><button type="button" onclick="location.reload()">${w.retry}</button></main></body></html>`;
}

/** Where a Needs-you item opens on the phone. Phone approvals (remote) open in /remote, where the exact item and its one-tap
 *  Approve live; everything else opens full ORBIT at the right place. Never approves by itself. */
export function needHref(o: BriefOpen, remote?: string): string {
  if (remote) return "/remote";
  if ("href" in o) return /^https?:\/\//i.test(o.href) || o.href.startsWith("/") ? o.href : "/";
  if ("link" in o) return "/" + (o.link.startsWith("#") ? o.link : "#" + o.link);
  if ("task" in o) return "/" + linkToHash({ planet: "operations", kind: "task", id: o.task });
  if ("goal" in o) return "/" + linkToHash({ planet: "agents", kind: "goal", id: o.goal });
  if ("work" in o) return "/" + linkToHash(o.work.kind === "task" ? { planet: "operations", kind: "task", id: o.work.id } : { planet: "agents", kind: "goal", id: o.work.id });
  if ("memory" in o && typeof o.memory === "string") return "/" + linkToHash({ planet: "memory", kind: "memory", id: o.memory });
  if ("panel" in o && typeof o.panel === "string") return "/" + linkToHash({ planet: o.panel as never, ...("view" in o && o.view ? { view: o.view } : {}) });
  return "/";
}

/** The planets that are easy to use on a phone (lists and one box, no 3D editing): label key + where it opens. */
export const PHONE_LINKS: { key: string; href: string }[] = [
  { key: "m.link.chat", href: "/chat" },
  { key: "m.link.remote", href: "/remote" },
  { key: "m.link.life", href: "/#o=life" },
  { key: "m.link.memory", href: "/#o=memory" },
  { key: "m.link.intel", href: "/#o=intelligence" },
  { key: "m.link.studio", href: "/#o=studio" },
];

export const ASK_KEY = "orbit.m.ask";
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
/** /m hands his question to /chat through this tab's sessionStorage, never the URL: a link from another site can't make CORE
 *  send anything. Returns where to go, or null for empty/overlong text. */
export function putAsk(store: Store, text: string): string | null {
  const q = text.trim();
  if (!q || q.length > 2000) return null;
  store.setItem(ASK_KEY, q);
  return "/chat";
}
/** ChatApp takes the handed-over question once. */
export function takeAsk(store: Store): string | null {
  const q = store.getItem(ASK_KEY);
  store.removeItem(ASK_KEY);
  return q && q.trim() && q.length <= 2000 ? q.trim() : null;
}

type StoryLike = { title: string | null; cites: string[] };
type CiteLike = { id: string; url: string; source: string | null };
/** Top stories for the phone: title, the first cited article's link (for its picture) and outlet. Stories without a title are skipped. */
export function topStories(stories: StoryLike[], cites: CiteLike[], max = 3): { title: string; url: string | null; source: string | null }[] {
  const out: { title: string; url: string | null; source: string | null }[] = [];
  for (const s of stories) {
    if (!s.title) continue;
    const c = s.cites.map((id) => cites.find((x) => x.id === id)).find((x) => x && /^https?:\/\//i.test(x.url));
    out.push({ title: s.title, url: c ? c.url : null, source: c ? c.source : null });
    if (out.length >= max) break;
  }
  return out;
}
