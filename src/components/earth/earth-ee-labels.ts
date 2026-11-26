// Estonia close-up labels (feat/earth-ee-hud): district names, landmarks with thin leader lines, and the local news as pins with
// small glass cards (category colour, title, time). Decluttered every frame (never over each other or the panels), fading by
// distance. A card click sends the story to the Intelligence panel (EARTH_STORY_EVENT). Rules and data: earth-ee-places-pure.ts.
import { declutter, distFade, newsPins, pinTime, ptile, CAT_COLOR, EARTH_STORY_EVENT, type Box, type Cand, type EarthStory, type EePlace, type NewsPin } from "@/lib/earth-ee-places-pure";
/** Screen position (host px) and camera distance (km) of a point `h` metres above the ground, or null when behind or off screen. */
export type Project = (lon: number, lat: number, h: number) => { x: number; y: number; km: number } | null;

type Item = { id: string; lon: number; lat: number; h: number; el: HTMLElement; w: number; h2: number; pri: number; lead: number; near: number; far: number; line?: SVGLineElement; dot?: SVGCircleElement };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const SIGN: Record<string, string> = { church: "✝", tower: "▲", castle: "♜", townhall: "◆", port: "⚓", museum: "▣", sight: "●" };

export function createEeLabels(parent: HTMLElement, placesUrl: (x: number, y: number) => string) {
  const root = document.createElement("div"); root.className = "eel"; parent.appendChild(root);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("class", "eel-lines"); root.appendChild(svg);
  const places = new Map<string, EePlace[] | "loading">(), items = new Map<string, Item>();
  let pins: Item[] = [], towns: Parameters<typeof newsPins>[0] = [], placed0: EePlace[] = [], dirty = false;

  function add(id: string, lon: number, lat: number, h: number, html: string, cls: string, pri: number, lead: number, near: number, far: number) {
    const el = document.createElement("div"); el.className = `eel-i ${cls}`; el.innerHTML = html; el.style.opacity = "0"; root.appendChild(el);
    const it: Item = { id, lon, lat, h, el, w: 0, h2: 0, pri, lead, near, far };
    if (lead) { it.line = document.createElementNS("http://www.w3.org/2000/svg", "line"); svg.appendChild(it.line); it.dot = document.createElementNS("http://www.w3.org/2000/svg", "circle"); it.dot.setAttribute("r", cls === "eel-p" ? "4" : "2.5"); svg.appendChild(it.dot); }
    return it;
  }
  function addPlaces(ps: EePlace[]) {
    for (const p of ps) {
      const id = `${p.kind}:${p.name}:${p.lon.toFixed(3)}`; if (items.has(id)) continue;
      items.set(id, p.kind === "district"
        ? add(id, p.lon, p.lat, 30, `<b>${esc(p.name)}</b>`, "eel-d", p.pri, 0, 0.9, 5)
        : add(id, p.lon, p.lat, 25, `<i>${SIGN[p.type] ?? "●"}</i><b>${esc(cut(p.name, 34))}</b>`, `eel-l eel-${p.type}`, p.pri - 10, 22, 0.5, p.pri >= 60 ? 3 : 1.2));
    }
  }
  /** The local news (towns with stories) as pins; rebuilt when new places arrive (a headline may name one). */
  function setNews(t: Parameters<typeof newsPins>[0]) { towns = t; buildPins(); }
  function buildPins() {
    for (const p of pins) { p.el.remove(); p.line?.remove(); p.dot?.remove(); }
    const now = Date.now();
    pins = newsPins(towns, now, 12, placed0).map((n: NewsPin, i) => {
      const it = add(`pin${i}`, n.lon, n.lat, 12, `<em style="--c:${CAT_COLOR[n.cat]}">${n.cat}</em><b>${esc(cut(n.story.title, 46))}</b><small>${esc(n.place)}${pinTime(n.story.published_at, now) ? ` · ${pinTime(n.story.published_at, now)}` : ""}</small>`, "eel-p", 200 + n.pri, 30, 0.8, 4);
      it.el.style.setProperty("--c", CAT_COLOR[n.cat]);
      it.el.onclick = () => dispatchEvent(new CustomEvent<EarthStory>(EARTH_STORY_EVENT, { detail: { ...n.story, place: n.place, cat: n.cat } }));
      it.line!.setAttribute("stroke", CAT_COLOR[n.cat]); it.dot!.setAttribute("fill", CAT_COLOR[n.cat]);
      return it;
    });
  }
  function loadAround(lon: number, lat: number) {
    const c = ptile(lon, lat);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = c.x + dx, y = c.y + dy, key = `${x}/${y}`; if (places.has(key)) continue;
      places.set(key, "loading");
      void fetch(placesUrl(x, y)).then((r) => (r.ok ? r.json() : { places: [] })).then((j) => { const ps = (j.places ?? []) as EePlace[]; places.set(key, ps); addPlaces(ps); placed0 = placed0.concat(ps); dirty = true; }).catch(() => places.delete(key));
    }
  }
  let lastLoad = "";
  /** k: the close-up layer's opacity (0 hides all). area: the free stage. blocked: panels and other HUD boxes (host px). */
  function frame(project: Project, cam: { lon: number; lat: number }, k: number, area: Box, blocked: Box[]) {
    root.style.display = k > 0.02 ? "" : "none"; if (k <= 0.02) return;
    const key = `${cam.lon.toFixed(2)},${cam.lat.toFixed(2)}`; if (key !== lastLoad) { lastLoad = key; loadAround(cam.lon, cam.lat); }
    if (dirty) { dirty = false; buildPins(); }
    const all = [...pins, ...items.values()], cands: Cand[] = [], pos = new Map<string, { a: number; it: Item }>();
    for (const it of all) {
      const s = project(it.lon, it.lat, it.h); const a = s ? distFade(s.km, it.near, it.far) : 0;
      if (!s || a < 0.05) { it.el.style.opacity = "0"; it.el.style.pointerEvents = "none"; if (it.line) it.line.style.opacity = it.dot!.style.opacity = "0"; continue; }
      if (!it.w) { it.w = it.el.offsetWidth || 100; it.h2 = it.el.offsetHeight || 18; }
      cands.push({ id: it.id, x: s.x, y: s.y, w: it.w, h: it.h2, pri: it.pri + a * 20, lead: it.lead, group: it.el.classList.contains("eel-l") ? "l" : it.el.classList.contains("eel-d") ? "d" : "p" }); pos.set(it.id, { a, it });
    }
    const placed = new Map(declutter(cands, area, blocked, 4, { l: 7, d: 6, p: 6 }).map((p) => [p.id, p]));
    for (const [id, { a, it }] of pos) {
      const p = placed.get(id), op = p ? a * k : 0;
      it.el.style.opacity = op.toFixed(2); it.el.style.pointerEvents = p && it.el.onclick ? "auto" : "none";
      if (p) it.el.style.transform = `translate(${p.bx.toFixed(1)}px,${p.by.toFixed(1)}px)`;
      if (it.line) {
        it.line.style.opacity = it.dot!.style.opacity = op.toFixed(2);
        if (p) { it.dot!.setAttribute("cx", p.x.toFixed(1)); it.dot!.setAttribute("cy", p.y.toFixed(1)); }
        if (p) { const ex = Math.min(Math.max(p.x, p.bx), p.bx + it.w), ey = Math.min(Math.max(p.y, p.by), p.by + it.h2); it.line.setAttribute("x1", p.x.toFixed(1)); it.line.setAttribute("y1", p.y.toFixed(1)); it.line.setAttribute("x2", ex.toFixed(1)); it.line.setAttribute("y2", ey.toFixed(1)); }
      }
    }
  }
  return { frame, setNews, loading: () => [...places.values()].filter((v) => v === "loading").length, dispose() { root.remove(); } };
}

export const EE_LABELS_CSS = `
.eel{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.eel-lines{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.eel-lines circle{fill:#8fe6ff;stroke:rgba(0,0,0,.6);stroke-width:1;transition:opacity .25s}
.eel-lines line{stroke:rgba(150,230,255,.75);stroke-width:1;transition:opacity .25s}
.eel-i{position:absolute;left:0;top:0;white-space:nowrap;transition:opacity .25s;color:#eef6ff;text-shadow:0 1px 3px rgba(0,0,0,.95),0 0 8px rgba(0,0,0,.6)}
.eel-d b{display:block;font:600 13px/1.1 var(--font-inter,system-ui);letter-spacing:.08em;text-transform:uppercase}
.eel-l{display:flex;gap:5px;align-items:center;font:500 11.5px/1.2 var(--font-inter,system-ui)}
.eel-l i{font-style:normal;color:#8fe6ff;font-size:10px}
.eel-p{display:grid;grid-template-columns:auto;gap:1px;max-width:220px;padding:5px 9px 6px 10px;cursor:pointer;background:linear-gradient(180deg,rgba(6,16,28,.78),rgba(4,10,20,.66));backdrop-filter:blur(6px);border:1px solid color-mix(in srgb,var(--c) 70%,transparent);border-left:3px solid var(--c);border-radius:4px;box-shadow:0 0 14px color-mix(in srgb,var(--c) 25%,transparent);text-shadow:none}
.eel-p em{font:700 9px/1 var(--font-inter,system-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--c);font-style:normal}
.eel-p b{font:600 11.5px/1.25 var(--font-inter,system-ui);white-space:normal}
.eel-p small{font-size:10px;color:rgba(220,235,250,.7)}
.eel-p:hover{background:rgba(10,26,44,.9)}
`;
