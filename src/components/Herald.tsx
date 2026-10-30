"use client";
// Herald: animated pop-up cards top-right (uploads, viral trends, briefings, breaking news, STUDIO/agent notices).
// Bell first; shared interruption judgment gates pop-ups, desktop alerts and speech.
import { useCallback, useEffect, useRef, useState } from "react";
import { NAV_EVENT } from "@/lib/nav-pure";
import { NOTIFY_EVENT, notify, type NotifyDetail } from "@/lib/notify-pure";
import {
  DEV_TAB_EVENT, DEV_TAB_KEY, HERALD_KEY, KIND_ICON, MAX_ON_SCREEN, breakingCards, briefCard, morningCard, parseHerald,
  trendCards, uploadNudge, type HeraldAction, type HeraldCard, type HeraldState,
} from "@/lib/herald-pure";
import { AWAY_MS, CORE_BUSY, GATHER_MS, LAST_SEEN_KEY, POPUP_SHOWN, RESOLVE_ALERT, THEATER_EVENT, classify, digestQueue, dismissKind, focusRunning, reasonLine, selectInterruptions, signalFor, type Signal } from "@/lib/interruption-pure";
import { FOCUS_TIMER_KEY } from "@/lib/focus-timer-pure";
import { useT } from "./i18n";
import { loadJudgment, saveJudgment } from "./interruption-store";
import { speakChunk, speechSettings, speakingOrJustEnded } from "./voice/speak";
import { inboxOffer } from "@/lib/herald-watch-pure";
import { want, wantingNow } from "./startup-store";

const MUTE_EVENT = "orbit:herald-mute";
const load = () => { try { return parseHerald(localStorage.getItem(HERALD_KEY), Date.now()); } catch { return parseHerald(null, Date.now()); } };
const save = (s: HeraldState) => { try { localStorage.setItem(HERALD_KEY, JSON.stringify(s)); } catch { /* storage unavailable: a card may repeat after reload */ } };
const getJson = (u: string) => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const morningDay = (): string | null => { try { return JSON.parse(localStorage.getItem("orbit.morning") || "{}")?.day ?? null; } catch { return null; } }; // MorningCard's saved day
const MIN = 60_000, COLLAPSE_MS = 12_000, PILL_MS = 72_000; // card 12 s, then a pill for a minute, then only the bell
const EVERY = { clips: 10 * MIN, briefs: 15 * MIN, trends: 45 * MIN, inbox: 10 * MIN }; // trends: server caches 30 min; inbox: the server's niche scan (src/lib/herald-watch.ts) does the YouTube calls
type Notice = NotifyDetail & { key: string };
type Shown = HeraldCard & { at: number; open: boolean; notice: Notice };

/** "Clip it now": the same request as STUDIO's Add from link with "make clips when downloaded" on (defaults: 5 clips, ≤45 s). */
export async function startClip(url: string) {
  const studio = { panel: "studio" as const, view: "clips" as const };
  try {
    const r = await fetch("/api/studio/clips/download", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, permission: "", autoClip: { preset: "viral" } }) });
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) throw new Error(j.error || `Couldn't start (${r.status})`);
    notify({ kind: "studio", title: "🎬 Cooking your clips", body: `Downloading ${url.slice(-11)}, then ORBIT finds the best moments. Watch it in STUDIO.`, nav: studio });
  } catch (e) {
    notify({ kind: "studio", title: "Couldn't start the clip", body: e instanceof Error ? e.message : "Something went wrong", nav: studio });
  }
}

export function Herald({ home, coreBusy = false }: { home: boolean; coreBusy?: boolean }) {
  const [cards, setCards] = useState<Shown[]>([]);
  const queue = useRef<Notice[]>([]);
  const count = useRef(0);
  count.current = cards.length;
  const homeRef = useRef(home);
  homeRef.current = home;
  const attention = useRef({ lastTyped: Date.now(), localBusy: false, coreBusy, theater: false });
  const gather = useRef(0); // back after AWAY_MS: until this time non-urgent notices wait to become one digest
  const { t } = useT();
  const tRef = useRef(t);
  tRef.current = t;
  attention.current.coreBusy = coreBusy;
  const hover = useRef(false);
  const [said, setSaid] = useState(""); // screen-reader line for new cards only (collapsing must not re-announce)

  const pump = useCallback(() => {
    const legacy = load(), a = attention.current, now = Date.now();
    const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
    if (document.visibilityState === "visible") {
      if (!gather.current && now - (Number(get(LAST_SEEN_KEY)) || now) >= AWAY_MS) gather.current = now + GATHER_MS;
      try { localStorage.setItem(LAST_SEEN_KEY, String(now)); } catch { /* no digest across reloads */ }
    }
    if (gather.current && now >= gather.current) {
      gather.current = 0;
      const d = digestQueue(queue.current, loadJudgment());
      queue.current = d.urgent;
      if (d.digest.length > 1) {
        const title = tRef.current("herald.digest", { n: d.digest.length }), body = d.digest.slice(0, 3).map((x) => x.title).join(" · ");
        notify({ key: `digest:${now}`, kind: "core", signal: "briefing", title, body, reason: tRef.current("herald.digestHint"), herald: { key: `digest:${now}`, kind: "brief", title, body, actions: [] } });
      } else queue.current.push(...d.digest);
    }
    const waiting = gather.current ? queue.current.filter((n) => classify(n, loadJudgment()) !== "URGENT") : [];
    const r = selectInterruptions(loadJudgment(), queue.current.filter((n) => !waiting.includes(n)), now, {
      focus: focusRunning(get(FOCUS_TIMER_KEY), now), theater: a.theater, startup: wantingNow().some((s) => s !== "alert"),
      visible: document.visibilityState === "visible", worldOpen: !homeRef.current,
      coreBusy: a.coreBusy || a.localBusy || speakingOrJustEnded(2000), lastTyped: a.lastTyped,
      popupsOff: legacy.mute || legacy.snooze > Date.now(),
    }, MAX_ON_SCREEN - count.current);
    queue.current = [...waiting, ...r.pending];
    if (!r.show.length) return;
    saveJudgment(r.state);
    const at = Date.now(), shown: Shown[] = [];
    for (const n of r.show) {
      const urgent = classify(n, r.state) === "URGENT";
      if (document.visibilityState !== "visible") {
        if (urgent && typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            const desktop = new Notification(n.title, { body: reasonLine(n), tag: n.key, silent: true });
            desktop.onclick = () => { window.focus(); desktop.close(); if (n.nav) dispatchEvent(new CustomEvent(NAV_EVENT, { detail: n.nav })); };
          } catch { /* the bell and red chip retain the alert */ }
        }
        continue;
      }
      const c = n.herald ?? { key: n.key, kind: n.kind === "agents" ? "agents" as const : "studio" as const,
        title: n.title, body: n.body, actions: n.nav ? [{ label: n.fixLabel ?? "Open", nav: n.nav }] : [] };
      shown.push({ ...c, at, open: true, notice: n });
      if (urgent && document.hasFocus() && speechSettings().speak && !a.coreBusy && !a.localBusy && !speakingOrJustEnded(2000)) speakChunk(reasonLine(n));
    }
    count.current += shown.length;
    if (shown.length) dispatchEvent(new CustomEvent(POPUP_SHOWN, { detail: shown.map((c) => c.notice.key) }));
    setCards((c) => [...shown, ...c]); // urgent bypass never evicts a card
    setSaid(shown.map((x) => reasonLine(x.notice)).join(". "));
  }, []);
  const offer = useCallback((xs: (HeraldCard | null)[]) => {
    for (const c of xs) if (c) notify({ key: c.key, kind: c.kind === "agents" ? "agents" : "studio", title: c.title, body: c.body,
      reason: c.kind === "brief" ? "A new briefing is ready to read." : c.body || c.title,
      signal: c.kind === "brief" ? "briefing" : c.kind === "trend" ? "scout" : "routine", nav: c.actions[0]?.nav, herald: c });
  }, []);

  useEffect(() => {
    const last = { clips: 0, briefs: 0, trends: 0, inbox: 0 };
    let busy = false, stopped = false;
    const briefs = async () => {
      const b = await getJson("/api/briefings");
      if (b && !stopped) offer([briefCard(b.briefings, Date.now()), ...breakingCards(b.articles, Date.now())]);
    };
    const tick = async () => {
      if (busy || stopped || document.visibilityState !== "visible") return;
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
        if (due.includes("inbox")) { const h = await getJson("/api/herald"); if (h?.cards && !stopped) offer(inboxOffer(h.cards, Date.now())); }
      } finally { busy = false; }
    };
    const onVis = () => { pump(); void tick(); };
    const onNews = () => { void briefs(); }; // a briefing just finished
    const onNotify = (e: Event) => {
      const n = (e as CustomEvent<NotifyDetail>).detail;
      if (!n?.title) return;
      const key = n.key ?? `n:${n.kind}:${n.title}|${n.body ?? ""}`;
      const s = loadJudgment();
      if (Object.hasOwn(s.seen, key)) return;
      saveJudgment({ ...s, seen: { ...s.seen, [key]: Date.now() } });
      queue.current.push({ ...n, key }); pump();
    };
    const typed = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) attention.current.lastTyped = Date.now();
    };
    const onBusy = (e: Event) => { attention.current.localBusy = (e as CustomEvent<boolean>).detail === true; };
    const onTheater = (e: Event) => { attention.current.theater = (e as CustomEvent<boolean>).detail === true; };
    const resolve = (e: Event) => { const signal = (e as CustomEvent<Signal>).detail; queue.current = queue.current.filter((n) => signalFor(n) !== signal); setCards((cs) => cs.filter((c) => signalFor(c.notice) !== signal)); };
    const scheduler = setInterval(pump, 1000);
    document.addEventListener("input", typed, true); document.addEventListener("keydown", typed, true);
    addEventListener(CORE_BUSY, onBusy); addEventListener(RESOLVE_ALERT, resolve); addEventListener(THEATER_EVENT, onTheater);
    const first = setTimeout(() => void tick(), 8_000); // let ORBIT boot first
    const h = setInterval(() => void tick(), MIN);
    document.addEventListener("visibilitychange", onVis);
    addEventListener("orbit:news", onNews);
    addEventListener(NOTIFY_EVENT, onNotify);
    return () => {
      stopped = true; clearInterval(scheduler);
      document.removeEventListener("input", typed, true); document.removeEventListener("keydown", typed, true);
      removeEventListener(CORE_BUSY, onBusy); removeEventListener(RESOLVE_ALERT, resolve); removeEventListener(THEATER_EVENT, onTheater);
      clearTimeout(first); clearInterval(h);
      document.removeEventListener("visibilitychange", onVis); removeEventListener("orbit:news", onNews); removeEventListener(NOTIFY_EVENT, onNotify);
    };
  }, [offer, pump]);

  // Collapse to a pill after 12 s (urgent ones leave: the red chip has them), drop the pill a minute later, but never while the pointer or keyboard is on the stack.
  useEffect(() => {
    if (!cards.length) return;
    const h = setInterval(() => {
      if (hover.current) return;
      const now = Date.now();
      setCards((cs) => (cs.some((c) => !c.open && now - c.at > PILL_MS) ? cs.filter((c) => c.open || now - c.at <= PILL_MS) : cs)); // a pill leaves too; the bell keeps it
      const late = (c: Shown) => c.open && now - c.at > COLLAPSE_MS;
      // An urgent card leaves instead of becoming a pill: the header's red-alert chip is its persistent entry.
      setCards((cs) => (cs.some(late) ? cs.flatMap((c) => (!late(c) ? [c] : classify(c.notice, loadJudgment()) === "URGENT" ? [] : [{ ...c, open: false }])) : cs));
    }, 1000);
    return () => clearInterval(h);
  }, [cards]);
  useEffect(() => { if (cards.length < MAX_ON_SCREEN) pump(); }, [cards.length, pump]); // room freed: show what waited
  useEffect(() => want("alert", cards.some((c) => c.open && classify(c.notice, loadJudgment()) === "URGENT")), [cards]); // startup-pure: alert goes first

  useEffect(() => {
    const f = () => { if (load().mute) { setCards([]); queue.current = []; } };
    addEventListener(MUTE_EVENT, f);
    return () => removeEventListener(MUTE_EVENT, f);
  }, []);

  const dismiss = (key: string, rejected = false) => {
    const c = cards.find((c) => c.key === key);
    if (rejected && c) saveJudgment(dismissKind(loadJudgment(), signalFor(c.notice), Date.now()));
    setCards((cs) => cs.filter((c) => c.key !== key));
  };
  const act = (c: HeraldCard, a: HeraldAction) => {
    if (a.href) { if (/^https:\/\//i.test(a.href)) window.open(a.href, "_blank", "noopener,noreferrer"); return; } // keep the card: Watch, then still Clip it
    if (a.clip) void startClip(a.clip); // the user pressed "Clip it now": download + make clips, same as Add from link with auto-clip on
    if (a.devTab) {
      try { sessionStorage.setItem(DEV_TAB_KEY, a.devTab); } catch { /* the event below still reaches an open panel */ }
      dispatchEvent(new CustomEvent(DEV_TAB_EVENT, { detail: a.devTab }));
    }
    dispatchEvent(new CustomEvent(NAV_EVENT, { detail: a.nav }));
    dismiss(c.key);
  };
  useEffect(() => {
    const action = (e: Event) => { const d = (e as CustomEvent<{ card: HeraldCard; action: HeraldAction }>).detail; if (d?.card && d.action) act(d.card, d.action); };
    addEventListener("orbit:herald-action", action);
    return () => removeEventListener("orbit:herald-action", action);
  });
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
              <b className="herald-title flex-1">{classify(c.notice, loadJudgment()) === "URGENT" ? "🔴 " : ""}{c.title}</b>
              <button className="herald-x" onClick={() => dismiss(c.key, true)} aria-label={`Dismiss: ${c.title}`} title="Dismiss">✕</button>
            </div>
            {c.image && <img src={c.image} alt="" className="mt-1.5 w-full rounded-md" loading="lazy" referrerPolicy="no-referrer" />}
            <p className="mt-1 text-xs" aria-label="Why this appeared">{reasonLine(c.notice)}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.notice.fixHref === "/api/studio/oauth/start" && <a className="chip" href={c.notice.fixHref}>{c.notice.fixLabel ?? "Fix"}</a>}
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
