"use client";
// ORBIT's morning brief on the PC: on the first open from 06:00 each day, a calm full-width "Good morning" overlay over the galaxy
// that says the brief aloud (CORE's voice: Kokoro when picked in Settings, sentence by sentence) with one-tap actions per item.
// Data: /api/brief (brief.ts). MorningBrief.tsx decides when it shows and loads this file then. Approve uses the same routes as NightShift.tsx; emails and spends only open (he approves them there).
import { useEffect, useState } from "react";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { OPEN_MEMORY_EVENT } from "@/lib/palette-pure";
import { MARKETS_TAB, type Brief, type BriefItem } from "@/lib/brief-pure";
import { speakChunk, speechSettings, stop } from "./voice/speak";
import { api } from "./AgentMission";
import { DayPlan } from "./DayPlan";
import { useT } from "./i18n";
import { announce } from "./announce";
import { greetKey } from "@/lib/i18n-pure";

const ICON: Record<BriefItem["kind"], string> = { decision: "✋", night: "🌙", health: "🩺", calendar: "📅", school: "🎓", weather: "🌦", place: "📍", first: "➜", result: "✦", lesson: "💡", question: "❔", study: "🗂" };
type Got = Brief & { life: boolean };

export default function MorningBriefBody({ home, onOpenTask, onOpenGoal, onClose }: { home: boolean; onOpenTask: (id: string) => void; onOpenGoal: (id: string) => void; onClose: () => void }) {
  const { t, lang } = useT();
  const [b, setB] = useState<Got | null>(null);
  const [err, setErr] = useState("");
  const [planning, setPlanning] = useState(false);
  const [muted, setMuted] = useState(false);
  const [marks, setMarks] = useState<Record<string, string>>({}); // item id → what happened to it here

  useEffect(() => { // mounted by the MorningBrief gate when it is time to show
    fetch("/api/brief", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (j.error) throw new Error(j.error); if (j.off) onClose(); else setB(j); })
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load the brief"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!b) return;
    const say = speechSettings().speak; // muted in Settings → shown only
    setMuted(!say);
    announce(t("brief.ready"));
    if (say) for (const s of b.spoken.split(/(?<=[.!?])\s+/)) speakChunk(s); // one sentence per utterance: the next is made while one plays
    void fetch("/api/brief", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "shown", day: b.day, items: b.items.map((i) => i.id), spoken: say }) }).catch(() => {});
  }, [b?.day, b?.spoken]); // eslint-disable-line react-hooks/exhaustive-deps -- once per loaded brief, not on the LIFE toggle (which only changes b.life); t is fixed while open

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!home) return null;
  function close() { stop(); onClose(); }
  const post = (body: object) => api("/api/brief", { method: "POST", body: JSON.stringify(body) });
  const go = (i: BriefItem) => {
    const o = i.open;
    if (!o) return;
    close();
    if ("task" in o) onOpenTask(o.task);
    else if ("goal" in o) onOpenGoal(o.goal);
    else if ("work" in o) (o.work.kind === "task" ? onOpenTask : onOpenGoal)(o.work.id);
    else if ("memory" in o) dispatchEvent(new CustomEvent(OPEN_MEMORY_EVENT, { detail: { id: o.memory } }));
    else if ("study" in o) dispatchEvent(new CustomEvent<NavTarget>(NAV_EVENT, { detail: { panel: "memory", study: true } }));
    else if ("mission" in o) dispatchEvent(new CustomEvent<NavTarget>(NAV_EVENT, { detail: { panel: null, mission: true } }));
    else if ("doctor" in o) dispatchEvent(new CustomEvent<NavTarget>(NAV_EVENT, { detail: { panel: null, doctor: true } }));
    else if ("tab" in o) { try { sessionStorage.setItem(MARKETS_TAB, o.tab); } catch { /* opens on Watchlist */ } dispatchEvent(new CustomEvent<NavTarget>(NAV_EVENT, { detail: { panel: o.panel } })); }
    else dispatchEvent(new CustomEvent<NavTarget>(NAV_EVENT, { detail: { panel: o.panel, ...(o.view && { view: o.view }) } }));
  };
  const act = async (i: BriefItem, what: "approve" | "snooze") => {
    setErr("");
    try {
      const a = i.approve;
      if (what === "snooze") await post({ snooze: i.id });
      else if (a && "task" in a) await api(`/api/tasks/${a.task}`, { method: "POST", body: JSON.stringify({ action: "approve" }) });
      else if (a) await api("/api/goals", { method: "POST", body: JSON.stringify({ action: "ok", id: a.goal, step: a.step, stepId: a.stepId }) });
      setMarks((m) => ({ ...m, [i.id]: t(what === "snooze" ? "brief.snoozed" : "common.approved") }));
    } catch (e) { setErr(e instanceof Error ? e.message : t("common.failed")); }
  };
  const setLife = (life: boolean) => { setB((x) => x && { ...x, life }); void post({ life }).catch(() => {}); };

  return (
    <section className="morning-brief" role="dialog" aria-modal="false" aria-label={t("brief.aria")}>
      <div className="mb-inner glass hud-panel">
        <div className="flex items-center justify-between gap-2">
          <h2 className="mb-hello">{lang === "et" ? `${t(greetKey(new Date().getHours()))}.` : b?.greeting ?? "Good morning."}</h2>
          <div className="flex gap-1">
            <button className="chip" aria-pressed={planning} onClick={() => setPlanning((x) => !x)}>{t("brief.plan")}</button>
            {!muted && b && <button className="chip" onClick={() => { stop(); setMuted(true); }} aria-label={t("brief.muteAria")}>{t("brief.mute")}</button>}
            <button className="chip" onClick={close} aria-label={t("brief.skipAria")}>{t("brief.skip")}</button>
          </div>
        </div>
        <div aria-live="polite">
          {err && <p className="error text-sm" role="alert">{err}</p>}
          {!b && !err && <p className="muted text-sm">{t("brief.loading")}</p>}
          {b && !b.items.length && <p className="muted">{t("brief.empty")}</p>}
          {b && b.items.length > 0 && (
            <ul className="mt-3 grid gap-2">
              {b.items.map((i, k) => (
                <li key={i.id} className="mb-item" style={{ "--i": k } as React.CSSProperties}>
                  <span className="mb-icon" aria-hidden>{ICON[i.kind]}</span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate">{i.title}</b>
                    {i.detail && <span className="muted block text-xs">{i.detail}</span>}
                  </span>
                  {marks[i.id] ? <span className="muted text-xs">{marks[i.id]}</span> : (
                    <span className="flex shrink-0 gap-1">
                      {i.approve && <button className="chip" onClick={() => void act(i, "approve")}>{t("common.approve")}</button>}
                      {i.open && <button className="chip" onClick={() => go(i)}>{t("common.open")}</button>}
                      <button className="chip" onClick={() => void act(i, "snooze")} aria-label={t("brief.snoozeAria", { title: i.title })}>{t("brief.snooze")}</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {planning && <DayPlan onOpen={(open) => go({ open } as BriefItem)} />}
          {b && (
            <label className="muted mt-3 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={b.life} onChange={(e) => setLife(e.target.checked)} /> {t("brief.life")}
            </label>
          )}
        </div>
      </div>
    </section>
  );
}
