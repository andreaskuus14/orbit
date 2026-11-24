"use client";
// The one place to type on the galaxy home (MIX look, 23 Nov): "What do you need?", the mic with a live voice meter, and the
// voice buttons. The text he types lives here, not in Orbit: before, every key re-rendered the whole shell (galaxy included).
// Orbit gets the finished text through onRun and says whether the box should clear (a failed task keeps his words).
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type FormEvent } from "react";
import type { VoiceInput } from "../voice/useVoiceInput";
import { VoiceControls } from "../voice/VoiceControls";
import { voiceLevel } from "../voice/bus";
import { meterBars } from "@/lib/home-ui-pure";
import { useT } from "../i18n";

export type CommandBarHandle = { focus: () => void; set: (text: string) => void };

/** Nine thin bars that follow the mic level while a question is being taken; a calm flat line otherwise (no frames drawn). */
export function VoiceMeter({ live, reduced }: { live: boolean; reduced: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bars = Array.from(el.children) as HTMLElement[];
    const paint = (h: number[]) => h.forEach((v, i) => { if (bars[i]) bars[i].style.transform = `scaleY(${v})`; });
    if (!live) { paint(meterBars(0, 0, bars.length)); return; }
    let raf = 0, t0 = performance.now();
    const step = (now: number) => { paint(meterBars(voiceLevel.mic, reduced ? 0 : (now - t0) / 1000, bars.length)); raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); t0 = 0; };
  }, [live, reduced]);
  return <span ref={ref} className="cmd-meter" data-live={live || undefined} aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span>;
}

export const CommandBar = forwardRef<CommandBarHandle, {
  voice: VoiceInput; mode: "ask" | "task"; onSwitchMode: () => void; onRun: (text: string) => Promise<boolean> | boolean;
  err: string; reply: string; hidden?: boolean; home?: boolean; reduced: boolean;
}>(function CommandBar({ voice, mode, onSwitchMode, onRun, err, reply, hidden, home, reduced }, ref) {
  const { t } = useT();
  const [cmd, setCmd] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus(), set: (s: string) => setCmd(s) }), []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (voice.listening) { voice.stop(); return; } // Enter while talking = done talking
    const text = cmd.trim();
    if (!text) return;
    if (await onRun(text)) setCmd((now) => (now.trim() === text ? "" : now)); // he may have typed on while it ran
  }
  const ph = t(voice.listening ? "cmd.listening" : mode === "ask" ? "cmd.askPh" : "cmd.taskPh");
  return (
    <form onSubmit={submit} className="glass cmdbar" data-tour="ask" data-home={home || undefined} data-listening={voice.listening || undefined} hidden={hidden}>
      <div className="cmd-row">
        {mode === "task" ? <button type="button" className="chip cmd-mode shrink-0" onClick={onSwitchMode} title={t("cmd.modeTitle")}
          aria-label={t("cmd.modeAria", { mode: t("cmd.modeTask") })}>{t("cmd.task")}</button>
          : <svg className="cmd-spark" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 1.5c.4 3.1 1.9 4.6 5 5-3.1.4-4.6 1.9-5 5-.4-3.1-1.9-4.6-5-5 3.1-.4 4.6-1.9 5-5Z" fill="currentColor" /></svg>}
        <input ref={input} className={"field cmd-field w-full" + (voice.listening ? " voice-live" : "")} value={voice.listening ? voice.interim : cmd} onChange={(e) => setCmd(e.target.value)} maxLength={8000}
          readOnly={voice.listening} placeholder={ph} enterKeyHint="send"
          aria-label={t(voice.listening ? "cmd.liveAria" : mode === "ask" ? "cmd.askAria" : "cmd.taskAria")} />
        <VoiceControls voice={voice} />
        <VoiceMeter live={voice.listening} reduced={reduced} />
      </div>
      {(err || voice.error) && <p className="cmd-note error" role="alert">{err || voice.error}</p>}
      {reply && <p className="cmd-note muted" role="status">{reply}</p>}
    </form>
  );
});
