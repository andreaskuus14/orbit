"use client";
// "Today in a minute": a short evening note. Opens on Ctrl/⌘+Shift+E, from the command bar ("today in a minute") or the search palette,
// and by itself once a day from the evening briefing time. Saved as a private journal memory (POST /api/evening); never sent anywhere else.
import { useEffect, useRef, useState } from "react";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { ENTRY_MAX, eveningDay, eveningDue } from "@/lib/evening-pure";
import { getSpeechRecognition, speechErrorMessage, speechLang, VOICE_PAUSE, VOICE_RESUME, type SpeechRec } from "./voice/useVoiceInput";

const KEY = "orbit.evening.shown"; // local day it last opened by itself
const typing = () => { const el = document.activeElement as HTMLElement | null; return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable); };

export function EveningCapture() {
  const ref = useRef<HTMLDialogElement>(null);
  const rec = useRef<SpeechRec | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [listening, setListening] = useState(false);
  const [canVoice, setCanVoice] = useState(false);

  useEffect(() => {
    setCanVoice(!!getSpeechRecognition());
    const open = () => { const d = ref.current; if (!d || d.open) return; setMsg(null); d.showModal(); };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "e") { e.preventDefault(); open(); }
    };
    const onNav = (e: Event) => { if ((e as CustomEvent<NavTarget>).detail?.evening) open(); };
    const auto = () => { // never over another dialog or while he is typing somewhere; tries again next minute
      if (document.visibilityState !== "visible" || document.querySelector("dialog[open]") || typing()) return;
      let last: string | null = null;
      try { last = localStorage.getItem(KEY); } catch { /* private mode */ }
      const now = new Date();
      if (!eveningDue(now, last)) return;
      try { localStorage.setItem(KEY, eveningDay(now)); } catch { /* may open again next minute */ }
      open();
    };
    auto();
    const t = setInterval(auto, 60_000);
    addEventListener("keydown", onKey);
    addEventListener(NAV_EVENT, onNav);
    return () => { clearInterval(t); removeEventListener("keydown", onKey); removeEventListener(NAV_EVENT, onNav); rec.current?.abort(); };
  }, []);

  const stopVoice = () => rec.current?.stop();
  const startVoice = () => {
    const Rec = getSpeechRecognition();
    if (!Rec || rec.current) return;
    const r = new Rec();
    r.lang = speechLang(); r.continuous = true; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = (e) => {
      let said = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) said += e.results[i][0].transcript;
      if (said.trim()) setText((t) => `${t}${t && !/\s$/.test(t) ? " " : ""}${said.trim()}`.slice(0, ENTRY_MAX));
    };
    r.onerror = (e) => { const m = speechErrorMessage(e.error); if (m) setMsg({ ok: false, text: m }); };
    r.onend = () => { rec.current = null; setListening(false); dispatchEvent(new Event(VOICE_RESUME)); };
    dispatchEvent(new Event(VOICE_PAUSE)); // "Hey Orbit" lets go of the mic meanwhile
    rec.current = r; setListening(true); setMsg(null);
    try { r.start(); } catch { r.onend?.(); }
  };

  const save = async () => {
    stopVoice();
    if (!text.trim() || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/evening", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn't save it");
      setText("");
      setMsg({ ok: true, text: "Saved. Sleep well." });
      setTimeout(() => ref.current?.close(), 1500);
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't save it" }); } // the text stays, so nothing is lost
    finally { setBusy(false); }
  };

  return (
    <dialog ref={ref} className="glass keys-overlay" aria-labelledby="evening-title" onClose={stopVoice}
      onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
      <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="flex items-center justify-between gap-4">
          <h2 id="evening-title" className="hud-title">TODAY IN A MINUTE</h2>
          <button type="button" className="chip" onClick={() => ref.current?.close()}>Close</button>
        </div>
        <label htmlFor="evening-text" className="muted text-xs">What happened, what mattered, what&apos;s next? A few lines is plenty. Private: kept as a journal memory.</label>
        <textarea id="evening-text" className="field evening-text" autoFocus maxLength={ENTRY_MAX} value={text} disabled={busy}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); } }} />
        <div className="flex items-center gap-2">
          <button type="submit" className="btn" disabled={busy || !text.trim()}>{busy ? "Saving…" : "Save"}</button>
          {canVoice && (
            <button type="button" className="chip" aria-pressed={listening} onClick={listening ? stopVoice : startVoice} disabled={busy}>
              {listening ? "■ Stop dictating" : "🎙 Dictate"}
            </button>
          )}
          <span className="num muted ml-auto text-xs" aria-hidden>{text.length}/{ENTRY_MAX}</span>
        </div>
        <p className="muted text-xs">Ctrl/⌘ Enter saves · Esc closes</p>
        {msg && <p className={`text-xs ${msg.ok ? "ok" : "error"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
      </form>
    </dialog>
  );
}
