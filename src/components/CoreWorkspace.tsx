"use client";
// CORE command workspace, right side: the turn's artifact (editable, "select → change this"), mission progress and voice state.
import { useEffect, useRef, useState } from "react";
import { changeRequest, type Artifact, type Mission } from "@/lib/core-workspace-pure";
import { voiceLevel } from "./voice/bus";
import { useT } from "./i18n";

export function CoreWorkspace({ artifact, mission, busy, heard, onAsk }: { artifact: Artifact | null; mission: Mission; busy: boolean; heard: string; onAsk: (text: string) => void }) {
  const { t, tn } = useT();
  const [text, setText] = useState(artifact?.body ?? "");
  const [sel, setSel] = useState("");
  const [ask, setAsk] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setText(artifact?.body ?? ""); setSel(""); }, [artifact?.body]);
  const [listening, setListening] = useState(false);
  // shortcut: polls the shared voice flag (no event exists for it); upgrade if bus.ts gains a listening event.
  useEffect(() => { const id = setInterval(() => setListening(voiceLevel.listening), 400); return () => clearInterval(id); }, []);
  const pick = () => { const a = area.current; if (a) setSel(a.value.slice(a.selectionStart, a.selectionEnd)); };
  const change = () => { if (!artifact || !ask.trim()) return; onAsk(changeRequest(artifact, sel || text, ask)); setAsk(""); };

  return <aside className="core-ws-side" aria-label={t("ws.aria")}>
    <section className="core-ws-card">
      <h3>{artifact ? artifact.title : t("ws.draft")}</h3>
      {!artifact && <p className="muted text-xs">{t("ws.draftEmpty")}</p>}
      {artifact?.kind === "preview" && <>
        <iframe src={artifact.href} title={t("ws.previewTitle")} className="core-ws-frame" sandbox="allow-scripts" />
        <a className="chip mt-2 inline-block" href={artifact.href} target="_blank" rel="noreferrer">{t("ws.openPreview")}</a>
      </>}
      {artifact && artifact.kind !== "preview" && <>
        <textarea ref={area} className="field core-ws-text" value={text} spellCheck={artifact.kind === "document"} aria-label={t("ws.editable", { title: artifact.title })}
          onChange={(e) => setText(e.target.value)} onSelect={pick} />
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          <button type="button" className="chip" onClick={() => void navigator.clipboard?.writeText(text)}>{t("common.copy")}</button>
          {text !== artifact.body && <button type="button" className="chip" onClick={() => setText(artifact.body)}>{t("ws.undo")}</button>}
        </div>
        <form className="mt-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); change(); }}>
          <input className="field flex-1 text-xs" value={ask} onChange={(e) => setAsk(e.target.value)} disabled={busy} maxLength={1000}
            placeholder={sel ? t("ws.changeSel", { n: sel.length }) : t("ws.changePh")} aria-label={t("ws.change")} />
          <button className="btn text-xs" disabled={busy || !ask.trim()}>{t("ws.change")}</button>
        </form>
      </>}
    </section>
    <section className="core-ws-card" aria-live="polite">
      <h3>{t("ws.progress")}</h3>
      {mission.proof && <p className={`core-ws-proof ${mission.proof}`}>{t(`ws.${mission.proof}`)}</p>}
      {mission.now && <p className="text-xs"><b>{t("ws.now")}</b> {mission.now}</p>}
      {!!mission.waiting.length && <p className="text-xs"><b>{t("ws.waiting")}</b> {mission.waiting.join(", ")}</p>}
      {!!mission.blockers.length && <ul className="text-xs error">{mission.blockers.map((b, i) => <li key={i}>✗ {b}</li>)}</ul>}
      {!!mission.done.length && <details className="text-xs muted"><summary>{tn("ws.doneSteps", mission.done.length)}</summary>
        <ul>{mission.done.map((d, i) => <li key={i}>✓ {d}</li>)}</ul></details>}
      {!mission.proof && !mission.now && <p className="muted text-xs">{t("ws.noWork")}</p>}
    </section>
    {/* Voice: only when something is happening (it used to say "Mic idle · No job running" all the time) */}
    {(listening || busy || heard) && <section className="core-ws-card text-xs">
      <h3>{t("ws.voice")}</h3>
      {(listening || busy) && <p>{listening ? <>● {t("ws.listening")}</> : null}{listening && busy ? " · " : ""}{busy ? t("ws.busyVoice") : null}</p>}
      {heard && <p className="muted">{t("ws.heard", { text: heard })}</p>}
    </section>}
  </aside>;
}
