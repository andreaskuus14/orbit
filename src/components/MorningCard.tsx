"use client";
// "Good morning" card on the galaxy: shown once per day on the first open after 05:00, or on "good morning" (then read aloud).
// Also the "Since you left" recap: on return after ≥ 3 h away it opens compact (or merges into the morning briefing).
import { useCallback, useEffect, useRef, useState } from "react";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { OPEN_MEMORY_EVENT } from "@/lib/palette-pure";
import { NOTIFY_KEY, parseItems } from "@/lib/notify-pure";
import { awaySince, countSince, localDay, shouldAutoShow, sinceEmpty, sinceSpoken, type Morning, type MorningNav, type MorningSince } from "@/lib/morning-pure";
import { speakChunk, speechSettings } from "./voice/speak";
import { MorningCards, MorningHero, trackCard } from "./MorningCards";
import type { WorkItem } from "@/lib/work-continuation-pure";
import type { Card } from "@/lib/morning-rank-pure";
import { WhileYouSlept } from "./NightShift";
import { useT } from "./i18n";
import { greetKey } from "@/lib/i18n-pure";

const KEY = "orbit.morning"; // { day: last auto-shown local day, speak: read it aloud when it auto-shows (speakMorning, default off) }
type Saved = { day?: string; speak?: boolean };
const load = (): Saved => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") ?? {}; } catch { return {}; } };
const save = (s: Saved) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable: may show again next open */ } };
const SEEN = "orbit.lastSeen"; // ms epoch of the last minute a window was visible (shared across windows)
const lastSeen = () => { try { const v = Number(localStorage.getItem(SEEN)); return v > 0 ? v : null; } catch { return null; } };
const markSeen = (t: number) => { try { localStorage.setItem(SEEN, String(t)); } catch { /* no storage: no recap */ } };
const whatsNewUp = () => !!document.querySelector(".whats-new, .morning-brief"); // WHAT'S NEW or the morning brief is on top: it owns Esc, and nothing is read aloud under it
type Req = { current: AbortController | null };
const begin = (r: Req) => { r.current?.abort(); return (r.current = new AbortController()); };
const end = (r: Req, c: AbortController) => { if (r.current === c) r.current = null; };
const notesSince = (from: number) => { try { return countSince(parseItems(localStorage.getItem(NOTIFY_KEY)), from); } catch { return 0; } };
const NAV: Record<MorningNav, NavTarget> = { review: { panel: "studio", view: "review" }, news: { panel: "intelligence" }, tasks: { panel: "operations" }, agents: { panel: "agents" }, life: { panel: "life" }, goals: { panel: "agents" } };

export function MorningCard({ home, onOpenTask, onOpenGoal }: { home: boolean; onOpenTask: (id: string) => void; onOpenGoal: (id: string) => void }) {
  const { t, tn, lang } = useT();
  const [data, setData] = useState<Morning | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [speakMorning, setSpeakMorning] = useState(false);
  const [recap, setRecap] = useState(false); // compact "welcome back" card (no morning sections)
  const [notes, setNotes] = useState(0);
  const openRef = useRef(false);
  openRef.current = open;
  const homeRef = useRef(home);
  homeRef.current = home;
  const ctrl = useRef<AbortController | null>(null); // the one request in flight; a newer show() aborts it


  // from: the away window to merge in. orbit.lastSeen moves forward only once that window was actually fetched, so a failure retries next tick.
  const show = useCallback(async (say: boolean, from: number | null = null) => {
    const c = begin(ctrl);
    setOpen(true); setRecap(false); setErr(""); setData(null); setNotes(from === null ? 0 : notesSince(from));
    try {
      const r = await fetch(`/api/morning${from === null ? "" : `?since=${from}`}`, { signal: c.signal });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't load the briefing");
      if (c.signal.aborted) return;
      if (from !== null) markSeen(Date.now());
      setData(j);
      // One sentence per utterance: Chrome cuts long ones off after ~15 s.
      if (say && speechSettings().speak && !whatsNewUp()) for (const s of (j as Morning).spoken.split(/(?<=[.!?])\s+/)) speakChunk(s);
    } catch (e) { if (!c.signal.aborted) setErr(e instanceof Error ? e.message : "Couldn't load the briefing"); }
    finally { end(ctrl, c); }
  }, []);

  // Recap only opens when something happened, so an empty one never flashes "Gathering…".
  const showRecap = useCallback(async (from: number) => {
    const c = begin(ctrl);
    try {
      const r = await fetch(`/api/morning?since=${from}&recap=1`, { signal: c.signal });
      if (!r.ok) return; // a failed recap stays quiet and keeps the old last-seen, so the next tick retries
      const { since } = (await r.json()) as { since: MorningSince };
      if (c.signal.aborted) return;
      markSeen(Date.now());
      const k = notesSince(from);
      if (sinceEmpty(since, k) || openRef.current) return; // never replace an open briefing
      setData({ since } as Morning); setNotes(k); setErr(""); setRecap(true); setOpen(true);
      // Said aloud only with "read the briefing aloud" on, like the morning card.
      if (load().speak && speechSettings().speak && !whatsNewUp()) for (const line of sinceSpoken(since, k).split(/(?<=[.!?])\s+/)) if (line) speakChunk(line);
    } catch { /* offline or aborted: no recap yet */ }
    finally { end(ctrl, c); }
  }, []);

  useEffect(() => {
    setSpeakMorning(!!load().speak);
    // On load, tab focus and every minute while visible (a sleeping laptop wakes with the tab still visible): ORBIT is often left open overnight.
    // Only visible minutes count as "seen", so time with the tab hidden counts as away. Auto-speak only when the card is actually on screen.
    const auto = () => {
      if (document.visibilityState !== "visible") return;
      const now = new Date(), s = load(), from = awaySince(lastSeen(), now.getTime()), morning = shouldAutoShow(s.day ?? null, now);
      if (from === null) { markSeen(now.getTime()); if (!morning) return; }
      else if (ctrl.current || (!morning && !homeRef.current)) return; // fetch in flight, or recap waits for the galaxy (away time keeps accruing)
      if (morning) { save({ ...s, day: localDay(now) }); void show(!!s.speak && homeRef.current, from); }
      else void showRecap(from!);
    };
    auto();
    const tick = setInterval(auto, 60_000);
    const onNav = (e: Event) => { if ((e as CustomEvent<NavTarget>).detail?.morning) void show(true); };
    addEventListener(NAV_EVENT, onNav);
    document.addEventListener("visibilitychange", auto);
    return () => { clearInterval(tick); removeEventListener(NAV_EVENT, onNav); document.removeEventListener("visibilitychange", auto); };
  }, [show, showRecap]);

  useEffect(() => {
    if (!open || !home) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !whatsNewUp()) setOpen(false); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, home]);

  if (!open || !home) return null;
  const nav = (t: NavTarget) => { setOpen(false); dispatchEvent(new CustomEvent(NAV_EVENT, { detail: t })); };
  const go = (k: MorningNav) => nav(NAV[k]);
  const openWork = (item: WorkItem) => { setOpen(false); if (item.kind === "task") onOpenTask(item.id); else onOpenGoal(item.id); };
  const bell = () => { setOpen(false); try { document.getElementById("notify-menu")?.showPopover(); } catch { /* already open */ } };
  const toggleSpeak = (v: boolean) => { setSpeakMorning(v); save({ ...load(), speak: v }); };
  // Orbit's OPEN_MEMORY_EVENT handler also switches to the MEMORY panel.
  const openMem = (id: string) => { setOpen(false); dispatchEvent(new CustomEvent(OPEN_MEMORY_EVENT, { detail: { id } })); };
  const openCard = (c: Card) => {
    void trackCard("click", c); // clicks per source: a source nobody opens for 14 days sinks (morning-rank-pure pickHero)
    const o = c.open;
    if ("work" in o) openWork(o.work); else if ("memory" in o) openMem(o.memory); else nav({ panel: o.panel, ...(o.view && { view: o.view }) });
  };
  const s = data?.studio, a = data?.agents, l = data?.life, cal = data?.calendar, sn = data?.since;
  const best = s?.yesterday.filter((y) => y.views !== null).sort((x, y) => y.views! - x.views!)[0];
  const away = sn ? Math.round((Date.now() - sn.from) / 3_600_000) : 0;
  const sinceBlock = sn && !sinceEmpty(sn, notes) && (
    <div>
      <b>{t("morning.since")}</b> <span className="muted text-xs">{away < 48 ? t("morning.hoursAgo", { n: away }) : tn("morning.daysAgo", Math.round(away / 24))}</span>
      <ul className="since-list muted grid gap-1">
        {(sn.done > 0 || sn.failed > 0) && <li><button onClick={() => go("tasks")}>🤖 {tn("since.tasks", sn.done)}{sn.failed ? t("since.failed", { n: sn.failed }) : ""}</button></li>}
        {!!sn.live && <li><button onClick={() => nav({ panel: "studio" })}>📺 {tn("since.live", sn.live)}</button></li>}
        {sn.clips > 0 && <li><button onClick={() => go("review")}>🎬 {tn("since.clips", sn.clips)}</button></li>}
        {!!sn.approvals && <li><button onClick={() => go("tasks")}>✋ {tn("since.approvals", sn.approvals)}</button></li>}
        {sn.reminders.map((t, k) => <li key={`r${k}`}><button onClick={() => nav({ panel: "life", life: "reminders" })}>⏰ {t}</button></li>)}
        {sn.alerts.map((t, k) => <li key={`a${k}`}><button onClick={() => nav({ panel: "markets" })}>📈 {t}</button></li>)}
        {notes > 0 && <li><button onClick={bell}>🔔 {tn("since.notes", notes)}</button></li>}
      </ul>
    </div>
  );

  return (
    <section className="glass hud-panel morning-card absolute right-3 top-16 z-20 w-[min(22rem,calc(100vw-1.5rem))] p-4 text-sm" aria-label={t(recap ? "morning.since" : "morning.aria")}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="hud-title">{recap ? t("morning.welcome") : (lang === "et" ? t(greetKey(new Date().getHours())) : data?.greeting ?? t("greet.morning")).toUpperCase()}</h2>
        <button className="chip" onClick={() => setOpen(false)} aria-label={t(recap ? "morning.dismissRecap" : "morning.dismiss")}>{t("common.close")}</button>
      </div>
      {recap ? sinceBlock : (
      <div aria-live="polite">
      {err && <p className="error" role="alert">{err}</p>}
      {!data && !err && <p className="muted">{t("morning.loading")}</p>}
      {data && (
        <div className="grid gap-3">
          {data.night && <WhileYouSlept report={data.night} onOpenTask={(id) => { setOpen(false); onOpenTask(id); }} onOpenGoal={(id) => { setOpen(false); onOpenGoal(id); }} nav={nav} />}
          {s?.pausedUntil && <p className="warn">{t("morning.ytPaused", { t: s.pausedUntil })}</p>}
          {data.hero && <MorningHero hero={data.hero} onOpen={openCard} />}
          <MorningCards cards={data.cards ?? []} problems={data.work?.problems} onOpen={openCard} />
          {sinceBlock}
          <details className="mc-more">
            <summary className="muted text-xs">{t("morning.more")}</summary>
            <div className="mt-2 grid gap-3">
              {data.overnight && <p className="muted text-xs">🌙 {data.overnight}</p>}
              <div className="mc-tiles">
                {s && <button className="mc-tile" onClick={() => go("review")}><b className="num">{s.ready}</b><span>{t("morning.tile.clips")}</span></button>}
                {s && <button className="mc-tile" onClick={() => nav({ panel: "studio" })}><b className="num">{s.today.length}</b><span>{t("morning.tile.live")}</span></button>}
                {a && <button className="mc-tile" onClick={() => go("tasks")}><b className="num">{a.proposals.length}</b><span>{t("morning.tile.proposals")}</span></button>}
                {l && l.habits > 0 && <button className="mc-tile" onClick={() => go("life")}><b className="num">{l.done}/{l.habits}</b><span>{t("morning.tile.habits")}</span></button>}
              </div>
              {best && (
                <button className="mc-hero" onClick={() => nav({ panel: "studio" })} aria-label={`Yesterday's best Short: ${best.title}, ${best.views!.toLocaleString()} views`}>
                  {best.videoId && <img src={`https://i.ytimg.com/vi/${best.videoId}/mqdefault.jpg`} alt="" loading="lazy" />}
                  <span className="mc-hero-k">{t("morning.best")}</span>
                  <span className="mc-hero-v num">{best.views!.toLocaleString()}<small>{t("morning.views")}</small></span>
                  <span className="mc-hero-t">{best.title}</span>
                </button>
              )}
              {data.mission && (
                <div aria-label="Today's mission">
                  <b>{t("morning.mission")}</b> <span className="muted text-xs">{t("morning.missionDone", { done: data.mission.done, total: data.mission.total })}</span>
                  <div className="mc-bar" aria-hidden><i style={{ width: `${(100 * data.mission.done) / Math.max(1, data.mission.total)}%` }} /></div>
                  <ul className="mt-1 grid gap-0.5">{data.mission.items.map((m) => (
                    <li key={m.id} className={m.done ? "ok" : undefined}>{m.done ? "✓" : "○"} {m.label} <span className="muted text-xs">· {m.progress}</span></li>))}</ul>
                </div>
              )}
              {s?.scout && <p className="muted text-xs">🛰 {s.scout}</p>}
              {a && a.failed > 0 && <p className="warn text-xs">{tn("morning.failed", a.failed)}</p>}
              {l?.next && <p className="muted text-xs">⏰ {l.next.at} · {l.next.text}</p>}
              {cal && (cal.connected
                ? cal.today.length > 0 && <ul className="muted grid gap-1 text-xs">{cal.today.slice(0, 4).map((e, k) => <li key={k}>📅 <span className="num">{e.time}</span> · {e.title}</li>)}</ul>
                : <a className="muted text-xs underline" href="/api/life/calendar/oauth">{t("morning.connectCal")}</a>)}
            </div>
          </details>
          <label className="muted flex items-center gap-2 text-xs"><input type="checkbox" checked={speakMorning} onChange={(e) => toggleSpeak(e.target.checked)} /> {t("morning.readAloud")}</label>
        </div>
      )}
      </div>
      )}
    </section>
  );
}
