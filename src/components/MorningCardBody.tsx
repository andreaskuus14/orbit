"use client";
// The "Good morning" / "Since you left" card's content. MorningCard.tsx decides when it opens and loads this then.
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { OPEN_MEMORY_EVENT } from "@/lib/palette-pure";
import { sinceEmpty, type Morning, type MorningNav } from "@/lib/morning-pure";
import { MorningCards, MorningHero, trackCard } from "./MorningCards";
import type { WorkItem } from "@/lib/work-continuation-pure";
import type { Card } from "@/lib/morning-rank-pure";
import { WhileYouSlept } from "./NightShift";
import MissionTargets from "./MissionTargets";
import { useT } from "./i18n";
import { greetKey } from "@/lib/i18n-pure";

const NAV: Record<MorningNav, NavTarget> = { review: { panel: "studio", view: "review" }, news: { panel: "intelligence" }, tasks: { panel: "operations" }, agents: { panel: "agents" }, life: { panel: "life" }, goals: { panel: "agents" } };

type Props = { data: Morning | null; err: string; recap: boolean; notes: number; speakMorning: boolean; onSpeak: (v: boolean) => void;
  close: () => void; onOpenTask: (id: string) => void; onOpenGoal: (id: string) => void };

export default function MorningCardBody({ data, err, recap, notes, speakMorning, onSpeak, close, onOpenTask, onOpenGoal }: Props) {
  const { t, tn, lang } = useT();
  const nav = (t: NavTarget) => { close(); dispatchEvent(new CustomEvent(NAV_EVENT, { detail: t })); };
  const go = (k: MorningNav) => nav(NAV[k]);
  const openWork = (item: WorkItem) => { close(); if (item.kind === "task") onOpenTask(item.id); else onOpenGoal(item.id); };
  const bell = () => { close(); try { document.getElementById("notify-menu")?.showPopover(); } catch { /* already open */ } };
  // Orbit's OPEN_MEMORY_EVENT handler also switches to the MEMORY panel.
  const openMem = (id: string) => { close(); dispatchEvent(new CustomEvent(OPEN_MEMORY_EVENT, { detail: { id } })); };
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
    <section className="glass hud-panel morning-card absolute right-3 top-16 z-20 w-[min(20rem,calc(100vw-1.5rem))] p-4 text-sm" aria-label={t(recap ? "morning.since" : "morning.aria")}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="hud-title">{recap ? t("morning.welcome") : (lang === "et" ? t(greetKey(new Date().getHours())) : data?.greeting ?? t("greet.morning")).toUpperCase()}</h2>
        <button className="chip" onClick={() => close()} aria-label={t(recap ? "morning.dismissRecap" : "morning.dismiss")}>{t("common.close")}</button>
      </div>
      {recap ? sinceBlock : (
      <div aria-live="polite">
      {err && <p className="error" role="alert">{err}</p>}
      {!data && !err && <p className="muted">{t("morning.loading")}</p>}
      {data && (
        <div className="grid gap-3">
          {data.night && <WhileYouSlept report={data.night} onOpenTask={(id) => { close(); onOpenTask(id); }} onOpenGoal={(id) => { close(); onOpenGoal(id); }} nav={nav} />}
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
                    <li key={m.id} className={m.done ? "ok" : undefined}>{m.done ? "✓" : "○"} {lang === "et" ? t(`mission.t.${m.id}` as "mission.t.shorts") : m.label} <span className="muted text-xs">· {m.noData ? t("mission.noData") : m.progress}</span></li>))}</ul>
                  <MissionTargets />
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
          <label className="muted flex items-center gap-2 text-xs"><input type="checkbox" checked={speakMorning} onChange={(e) => onSpeak(e.target.checked)} /> {t("morning.readAloud")}</label>
        </div>
      )}
      </div>
      )}
    </section>
  );
}
