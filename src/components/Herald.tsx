"use client";
// Herald: animated pop-up cards top-right (uploads, viral trends, briefings, breaking news, STUDIO/agent notices).
// Rules: src/lib/herald-pure.ts. Never speaks, never plays sound, never moves focus. Polls only while the tab is visible,
// never while muted or with Stop-all on. Cards collapse to a pill after 12 s; at most 3 on screen and 4 per hour.
import { useCallback, useEffect, useRef, useState } from "react";
import { NAV_EVENT } from "@/lib/nav-pure";
import { NOTIFY_EVENT, type NotifyDetail } from "@/lib/notify-pure";
import {
  CLIP_PREFILL_EVENT, CLIP_PREFILL_KEY, HERALD_KEY, KIND_ICON, MAX_ON_SCREEN, breakingCards, briefCard, fromNotify, morningCard, parseHerald,
  pickDue, trendCards, uploadNudge, type HeraldAction, type HeraldCard, type HeraldState,
} from "@/lib/herald-pure";

const MUTE_EVENT = "orbit:herald-mute";
const load = () => { try { return parseHerald(localStorage.getItem(HERALD_KEY), Date.now()); } catch { return parseHerald(null, Date.now()); } };
const save = (s: HeraldState) => { try { localStorage.setItem(HERALD_KEY, JSON.stringify(s)); } catch { /* storage unavailable: a card may repeat after reload */ } };
const getJson = (u: string) => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const morningDay = (): string | null => { try { return JSON.parse(localStorage.getItem("orbit.morning") || "{}")?.day ?? null; } catch { return null; } }; // MorningCard's saved day
const MIN = 60_000, COLLAPSE_MS = 12_000;
const EVERY = { clips: 10 * MIN, briefs: 15 * MIN, trends: 45 * MIN }; // trends: the server caches 30 min anyway
type Shown = HeraldCard & { at: number; open: boolean };

export function Herald({ home }: { home: boolean }) {
  const [cards, setCards] = useState<Shown[]>([]);
  const queue = useRef<HeraldCard[]>([]);
  const count = useRef(0);
  count.current = cards.length;
  const homeRef = useRef(home);
  homeRef.current = home;
  const hover = useRef(false);
  const [said, setSaid] = useState(""); // screen-reader line for new cards only (collapsing must not re-announce)

  const pump = useCallback(() => {
    const r = pickDue(load(), queue.current, Date.now(), document.visibilityState === "visible", MAX_ON_SCREEN - count.current);
    queue.current = r.queue;
    if (!r.show.length) return;
    save(r.state);
    const at = Date.now();
    count.current += r.show.length;
    setCards((c) => [...r.show.map((x) => ({ ...x, at, open: true })), ...c].slice(0, MAX_ON_SCREEN));
    setSaid(r.show.map((x) => x.title).join(". "));
  }, []);
  const offer = useCallback((xs: (HeraldCard | null)[]) => { queue.current.push(...xs.filter((x): x is HeraldCard => !!x)); pump(); }, [pump]);

  useEffect(() => {
    const last = { clips: 0, briefs: 0, trends: 0 };
    let busy = false, stopped = false;
    const briefs = async () => {
      const b = await getJson("/api/briefings");
      if (b && !stopped) offer([briefCard(b.briefings, Date.now()), ...breakingCards(b.articles, Date.now())]);
    };
    const tick = async () => {
      if (busy || stopped || document.visibilityState !== "visible" || load().mute) return;
      const now = Date.now();
      if (!homeRef.current) offer([morningCard(morningDay(), now)]); // on the galaxy MorningCard shows itself
      const due = (Object.keys(EVERY) as (keyof typeof EVERY)[]).filter((k) => now - last[k] >= EVERY[k]);
      if (!due.length) return;
      busy = true;
      try {
        // shortcut: asks /api/stop-all itself like HalEye does; switch to an event if StopAll ever broadcasts its state.
        if ((await getJson("/api/stop-all"))?.stop?.on) return;
        for (const k of due) last[k] = now;
        if (due.includes("clips")) { const d = await getJson("/api/studio/clips"); if (d && !stopped) offer([uploadNudge(d, Date.now())]); }
        if (due.includes("briefs")) await briefs();
        if (due.includes("trends")) { const t = await getJson("/api/devtools?trends=1"); if (t && !stopped) offer(trendCards(t)); }
      } finally { busy = false; }
    };
    const onVis = () => { pump(); void tick(); };
    const onNews = () => { if (!load().mute) void briefs(); }; // a briefing just finished
    const onNotify = (e: Event) => offer([fromNotify((e as CustomEvent<NotifyDetail>).detail ?? {})]);
    const first = setTimeout(() => void tick(), 8_000); // let ORBIT boot first
    const h = setInterval(() => void tick(), MIN);
    document.addEventListener("visibilitychange", onVis);
    addEventListener("orbit:news", onNews);
    addEventListener(NOTIFY_EVENT, onNotify);
    return () => {
      stopped = true; clearTimeout(first); clearInterval(h);
      document.removeEventListener("visibilitychange", onVis); removeEventListener("orbit:news", onNews); removeEventListener(NOTIFY_EVENT, onNotify);
    };
  }, [offer, pump]);

  // Collapse to a pill after 12 s, but never while the pointer or keyboard is on the stack.
  useEffect(() => {
    if (!cards.some((c) => c.open)) return;
    const h = setInterval(() => {
      if (hover.current) return;
      const now = Date.now();
      setCards((cs) => (cs.some((c) => c.open && now - c.at > COLLAPSE_MS) ? cs.map((c) => (c.open && now - c.at > COLLAPSE_MS ? { ...c, open: false } : c)) : cs));
    }, 1000);
    return () => clearInterval(h);
  }, [cards]);
  useEffect(() => { if (cards.length < MAX_ON_SCREEN) pump(); }, [cards.length, pump]); // room freed: show what waited

  useEffect(() => {
    const f = () => { if (load().mute) { setCards([]); queue.current = []; } };
    addEventListener(MUTE_EVENT, f);
    return () => removeEventListener(MUTE_EVENT, f);
  }, []);

  const dismiss = (key: string) => setCards((cs) => cs.filter((c) => c.key !== key));
  const act = (c: Shown, a: HeraldAction) => {
    if (a.clip) { // only prefills the clip factory's link box; the user still presses Add
      try { sessionStorage.setItem(CLIP_PREFILL_KEY, a.clip); } catch { /* the event below still fills an open box */ }
      dispatchEvent(new CustomEvent(CLIP_PREFILL_EVENT, { detail: a.clip }));
    }
    dispatchEvent(new CustomEvent(NAV_EVENT, { detail: a.nav }));
    dismiss(c.key);
  };
  const snooze = (c: Shown) => { save({ ...load(), snooze: Date.now() + 60 * MIN }); dismiss(c.key); };
  const mute = () => { save({ ...load(), mute: true }); setCards([]); dispatchEvent(new Event(MUTE_EVENT)); };
  const hold = (on: boolean) => {
    hover.current = on;
    if (!on) { const at = Date.now(); setCards((cs) => cs.map((c) => (c.open ? { ...c, at } : c))); } // a fresh 12 s after leaving
  };

  return (
    <section className="herald" aria-label="ORBIT heads-up"
      onMouseEnter={() => hold(true)} onMouseLeave={() => hold(false)}
      onFocus={() => hold(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hold(false); }}>
      <style>{CSS}</style>
      <p className="sr-only" role="status" aria-live="polite">{said}</p>
      {cards.map((c) => c.open ? (
        <article key={c.key} className={`herald-card glass k-${c.kind}`} aria-label={c.title}>
          <span className="herald-icon" aria-hidden>{KIND_ICON[c.kind]}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <b className="herald-title flex-1">{c.title}</b>
              <button className="herald-x" onClick={() => dismiss(c.key)} aria-label={`Dismiss: ${c.title}`} title="Dismiss">✕</button>
            </div>
            {c.body && <p className="muted mt-0.5 text-xs">{c.body}</p>}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.actions.map((a) => <button key={a.label} className="chip herald-go" onClick={() => act(c, a)}>{a.label}</button>)}
              <button className="chip" onClick={() => snooze(c)} title="No pop-ups for an hour">Snooze 1h</button>
              <button className="chip" onClick={mute} title="Turn pop-ups off (turn them back on in 🔔 Notifications)">Mute</button>
            </div>
          </div>
        </article>
      ) : (
        <button key={c.key} className={`herald-pill glass k-${c.kind}`} onClick={() => setCards((cs) => cs.map((x) => (x.key === c.key ? { ...x, open: true, at: Date.now() } : x)))}
          aria-label={`Show: ${c.title}`} title={c.title}>
          <span aria-hidden>{KIND_ICON[c.kind]}</span><span className="truncate">{c.title}</span>
        </button>
      ))}
    </section>
  );
}

/** "Pop-ups on/off" for the notification menu: the global Herald mute. */
export function HeraldToggle() {
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    const f = () => setMuted(load().mute);
    f(); addEventListener(MUTE_EVENT, f);
    return () => removeEventListener(MUTE_EVENT, f);
  }, []);
  return (
    <button className="chip" aria-pressed={!muted} title="Animated pop-ups for uploads, trends, briefings and breaking news"
      onClick={() => { save({ ...load(), mute: !muted, snooze: 0 }); dispatchEvent(new Event(MUTE_EVENT)); }}>
      Pop-ups {muted ? "off" : "on"}
    </button>
  );
}

const CSS = `
.herald { position: absolute; z-index: 40; top: 4.5rem; right: 0.75rem; width: min(21rem, calc(100vw - 1.5rem)); display: flex; flex-direction: column; align-items: flex-end; gap: 0.5rem; pointer-events: none; }
.herald > * { pointer-events: auto; }
.herald-card { --edge: #22d3ee; position: relative; overflow: hidden; width: 100%; display: flex; gap: 0.65rem; padding: 0.75rem 0.8rem 0.75rem 0.9rem; border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--edge) 45%, transparent); box-shadow: 0 0 22px color-mix(in srgb, var(--edge) 22%, transparent), 0 10px 30px rgba(0, 0, 0, 0.45);
  animation: herald-in 0.55s cubic-bezier(0.2, 0.9, 0.25, 1.15) both; font-size: 0.85rem; }
.herald-card::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--edge); box-shadow: 0 0 12px var(--edge); }
.herald-card::after { content: ""; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
  background: linear-gradient(105deg, transparent 35%, color-mix(in srgb, var(--edge) 28%, transparent) 50%, transparent 65%); transform: translateX(-100%);
  animation: herald-sweep 1.4s 0.25s ease-out both; }
.herald-icon { position: relative; flex: none; display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: 50%; font-size: 1rem;
  background: color-mix(in srgb, var(--edge) 16%, transparent); }
.herald-icon::after { content: ""; position: absolute; inset: -2px; border-radius: 50%; border: 2px solid var(--edge); animation: herald-ping 1.6s ease-out 2; opacity: 0; }
.herald-title { line-height: 1.25; }
.herald-x { color: var(--muted); padding: 0 0.2rem; border-radius: 6px; }
.herald-x:hover { color: var(--ink); }
.herald-go { border-color: color-mix(in srgb, var(--edge) 60%, transparent); }
.herald-pill { --edge: #22d3ee; max-width: 14rem; display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.7rem; border-radius: 999px; font-size: 0.75rem;
  border: 1px solid color-mix(in srgb, var(--edge) 50%, transparent); animation: herald-shrink 0.35s ease-out both; }
.herald-x:focus-visible, .herald-pill:focus-visible { outline: 2px solid var(--cyan, #22d3ee); outline-offset: 2px; }
.k-upload { --edge: #fbbf24; } .k-trend { --edge: #fb7185; } .k-brief { --edge: #38bdf8; } .k-breaking { --edge: #f43f5e; } .k-studio { --edge: #ff8fab; } .k-agents { --edge: #a78bfa; }
@keyframes herald-in { from { opacity: 0; transform: translateX(28px) scale(0.94); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes herald-sweep { to { transform: translateX(100%); } }
@keyframes herald-ping { 0% { opacity: 0.9; transform: scale(1); } 100% { opacity: 0; transform: scale(1.6); } }
@keyframes herald-shrink { from { opacity: 0; transform: scaleX(0.6); } to { opacity: 1; transform: none; } }
@keyframes herald-fade { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .herald-card, .herald-pill { animation: herald-fade 0.2s ease-out both; }
  .herald-card::after, .herald-icon::after { animation: none; display: none; }
}
@media (max-width: 760px) { .herald { top: calc(var(--hdr, 4rem) + 0.25rem); } }
`;
