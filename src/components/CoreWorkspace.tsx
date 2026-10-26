"use client";
// CORE command workspace, right side: the turn's artifact (editable, "select → change this"), mission progress and voice state.
import { useEffect, useRef, useState } from "react";
import { changeRequest, type Artifact, type Mission } from "@/lib/core-workspace-pure";
import { voiceLevel } from "./voice/bus";

const PROOF = { prepared: "Prepared — drafted, nothing run yet", executed: "Executed — actions ran, not independently checked", verified: "Verified — result checked or stored" };

export function CoreWorkspace({ artifact, mission, busy, heard, onAsk }: { artifact: Artifact | null; mission: Mission; busy: boolean; heard: string; onAsk: (text: string) => void }) {
  const [text, setText] = useState(artifact?.body ?? "");
  const [sel, setSel] = useState("");
  const [ask, setAsk] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setText(artifact?.body ?? ""); setSel(""); }, [artifact?.body]);
  const [listening, setListening] = useState(false);
  // shortcut: polls the shared voice flag (no event exists for it); upgrade if bus.ts gains a listening event.
  useEffect(() => { const t = setInterval(() => setListening(voiceLevel.listening), 400); return () => clearInterval(t); }, []);
  const pick = () => { const a = area.current; if (a) setSel(a.value.slice(a.selectionStart, a.selectionEnd)); };
  const change = () => { if (!artifact || !ask.trim()) return; onAsk(changeRequest(artifact, sel || text, ask)); setAsk(""); };

  return <aside className="core-ws-side" aria-label="CORE workspace">
    <section className="core-ws-card">
      <h3>{artifact ? artifact.title : "Artifact"}</h3>
      {!artifact && <p className="muted text-xs">Drafts, previews, tables and code from CORE appear here.</p>}
      {artifact?.kind === "preview" && <>
        <iframe src={artifact.href} title="Workspace preview" className="core-ws-frame" sandbox="allow-scripts" />
        <a className="chip mt-2 inline-block" href={artifact.href} target="_blank" rel="noreferrer">Open preview</a>
      </>}
      {artifact && artifact.kind !== "preview" && <>
        <textarea ref={area} className="field core-ws-text" value={text} spellCheck={artifact.kind === "document"} aria-label={`${artifact.title}, editable`}
          onChange={(e) => setText(e.target.value)} onSelect={pick} />
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          <button type="button" className="chip" onClick={() => void navigator.clipboard?.writeText(text)}>Copy</button>
          {text !== artifact.body && <button type="button" className="chip" onClick={() => setText(artifact.body)}>Undo edits</button>}
        </div>
        <form className="mt-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); change(); }}>
          <input className="field flex-1 text-xs" value={ask} onChange={(e) => setAsk(e.target.value)} disabled={busy} maxLength={1000}
            placeholder={sel ? `Change the selected ${sel.length} chars…` : "Select a part, then say what to change"} aria-label="Change this" />
          <button className="btn text-xs" disabled={busy || !ask.trim()}>Change this</button>
        </form>
      </>}
    </section>
    <section className="core-ws-card" aria-live="polite">
      <h3>Mission</h3>
      {mission.proof && <p className={`core-ws-proof ${mission.proof}`}>{PROOF[mission.proof]}</p>}
      {mission.now && <p className="text-xs"><b>Now:</b> {mission.now}</p>}
      {!!mission.waiting.length && <p className="text-xs"><b>Waiting:</b> {mission.waiting.join(", ")}</p>}
      {!!mission.blockers.length && <ul className="text-xs error">{mission.blockers.map((b, i) => <li key={i}>✗ {b}</li>)}</ul>}
      {!!mission.done.length && <details className="text-xs muted"><summary>{mission.done.length} completed {mission.done.length === 1 ? "step" : "steps"}</summary>
        <ul>{mission.done.map((d, i) => <li key={i}>✓ {d}</li>)}</ul></details>}
      {!mission.proof && !mission.now && <p className="muted text-xs">No work yet in this chat.</p>}
    </section>
    <section className="core-ws-card text-xs">
      <h3>Voice</h3>
      <p>{listening ? "● Listening" : "Mic idle"} · {busy ? "Job running — talking over it won't stop it; say “stop” to cancel" : "No job running"}</p>
      {heard && <p className="muted">Heard: “{heard}”</p>}
    </section>
  </aside>;
}
