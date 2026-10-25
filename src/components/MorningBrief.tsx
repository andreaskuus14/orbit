"use client";
// ORBIT's morning brief on the PC: on the first open from 06:00 each day, a calm full-width "Good morning" overlay over the galaxy
// that says the brief aloud (CORE's voice: Kokoro when picked in Settings, sentence by sentence) with one-tap actions per item.
// Data: /api/brief (brief.ts). Approve uses the same routes as NightShift.tsx; emails and spends only open (he approves them there).
import { useEffect, useRef, useState } from "react";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { OPEN_MEMORY_EVENT } from "@/lib/palette-pure";
import { localDay } from "@/lib/morning-pure";
import { MARKETS_TAB, shouldShowBrief, type Brief, type BriefItem } from "@/lib/brief-pure";
import { speakChunk, speechSettings, stop } from "./voice/speak";
import { api } from "./AgentMission";

const KEY = "orbit.brief"; // the local day it was last shown
const ICON: Record<BriefItem["kind"], string> = { decision: "✋", night: "🌙", calendar: "📅", first: "➜", result: "✦", lesson: "💡" };
type Got = Brief & { life: boolean };

export function MorningBrief({ home, onOpenTask, onOpenGoal }: { home: boolean; onOpenTask: (id: string) => void; onOpenGoal: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [b, setB] = useState<Got | null>(null);
  const [err, setErr] = useState("");
  const [muted, setMuted] = useState(false);
  const [marks, setMarks] = useState<Record<string, string>>({}); // item id → what happened to it here
  const homeRef = useRef(home);
  homeRef.current = home;

  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== "visible" || !homeRef.current) return;
      const now = new Date(), today = localDay(now);
      let last: string | null = null;
      try { last = localStorage.getItem(KEY); } catch { /* no storage: shows once per load */ }
      if (!shouldShowBrief(last, now.getHours(), today)) return;
      try { localStorage.setItem(KEY, today); } catch { /* ignore */ }
      setOpen(true); setErr(""); setB(null); setMarks({});
      fetch("/api/brief", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (j.error) throw new Error(j.error); setB(j); })
        .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load the brief"));
    };
    check();
    const t = setInterval(check, 60_000); // ORBIT is often left open overnight
    document.addEventListener("visibilitychange", check);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", check); };
  }, []);

  useEffect(() => {
    if (!b) return;
    const say = speechSettings().speak; // muted in Settings → shown only
    setMuted(!say);
    if (say) for (const s of b.spoken.split(/(?<=[.!?])\s+/)) speakChunk(s); // one sentence per utterance: the next is made while one plays
    void fetch("/api/brief", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "shown", day: b.day, items: b.items.map((i) => i.id), spoken: say }) }).catch(() => {});
  }, [b]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open]);

  if (!open || !home) return null;
  function close() { stop(); setOpen(false); }
  const post = (body: object) => api("/api/brief", { method: "POST", body: JSON.stringify(body) });
  const go = (i: BriefItem) => {
    const o = i.open;
    if (!o) return;
    close();
    if ("task" in o) onOpenTask(o.task);
    else if ("goal" in o) onOpenGoal(o.goal);
    else if ("work" in o) (o.work.kind === "task" ? onOpenTask : onOpenGoal)(o.work.id);
    else if ("memory" in o) dispatchEvent(new CustomEvent(OPEN_MEMORY_EVENT, { detail: { id: o.memory } }));
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
      setMarks((m) => ({ ...m, [i.id]: what === "snooze" ? "Snoozed till tomorrow" : "Approved" }));
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't do that"); }
  };
  const setLife = (life: boolean) => { setB((x) => x && { ...x, life }); void post({ life }).catch(() => {}); };

  return (
    <section className="morning-brief" role="dialog" aria-modal="false" aria-label="Morning brief">
      <div className="mb-inner glass hud-panel">
        <div className="flex items-center justify-between gap-2">
          <h2 className="mb-hello">{b?.greeting ?? "Good morning."}</h2>
          <div className="flex gap-1">
            {!muted && b && <button className="chip" onClick={() => { stop(); setMuted(true); }} aria-label="Mute the brief">Mute</button>}
            <button className="chip" onClick={close} aria-label="Skip the morning brief">Skip</button>
          </div>
        </div>
        <div aria-live="polite">
          {err && <p className="error text-sm" role="alert">{err}</p>}
          {!b && !err && <p className="muted text-sm">Pulling your morning together…</p>}
          {b && !b.items.length && <p className="muted">Nothing needs you this morning. Enjoy it.</p>}
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
                      {i.approve && <button className="chip" onClick={() => void act(i, "approve")}>Approve</button>}
                      {i.open && <button className="chip" onClick={() => go(i)}>Open</button>}
                      <button className="chip" onClick={() => void act(i, "snooze")} aria-label={`Snooze ${i.title} until tomorrow`}>Snooze</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {b && (
            <label className="muted mt-3 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={b.life} onChange={(e) => setLife(e.target.checked)} /> Say calendar titles and reminders aloud (from tomorrow)
            </label>
          )}
        </div>
      </div>
    </section>
  );
}
