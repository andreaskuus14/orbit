"use client";
// "Today in a minute": a short evening note. Opens on Ctrl/⌘+Shift+E, from the command bar ("today in a minute") or the search palette,
// and by itself once a day from the evening briefing time. Dictation is local Whisper only (never the browser recognizer,
// which sends audio to Google); without it, typing only. Saved as a private journal memory (POST /api/evening); never sent anywhere else.
import { useEffect, useRef, useState } from "react";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { ENTRY_MAX, eveningDay, eveningDue } from "@/lib/evening-pure";
import { speechErrorMessage, speechLang, VOICE_PAUSE, VOICE_RESUME } from "./voice/useVoiceInput";
import { recordUtterance, transcribeAudio } from "./voice/whisper";
import { whisperLang } from "./voice/bus";
import { useLifeShield } from "./useLifeShield";
import { useT } from "./i18n";
import { Button } from "./ui/Button";
import { IconClose } from "./ui/icons";
import "@/app/planet-ui.css";

const KEY = "orbit.evening.shown"; // local day it last opened by itself
const typing = () => { const el = document.activeElement as HTMLElement | null; return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable); };

export function EveningCapture() {
  const { t: tr } = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const rec = useRef<{ stop(): void; abort(): void } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [noLocal, setNoLocal] = useState(false);
  useLifeShield("evening", isOpen); // desk screenshots are refused while this is open
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [listening, setListening] = useState(false);
  const [canVoice, setCanVoice] = useState(false);
  const [review, setReview] = useState(""); // the accepted day plan: done / missed (api/dayplan)

  useEffect(() => {
    const open = () => {
      const d = ref.current; if (!d || d.open) return; setMsg(null); d.showModal(); setIsOpen(true);
      // Local Whisper on this PC is the only way to dictate here.
      fetch(`/api/voice/transcribe?lang=${whisperLang(speechLang())}`).then((r) => r.json()).then((j) => { setCanVoice(j?.ready === true); setNoLocal(j?.ready !== true); }, () => { setCanVoice(false); setNoLocal(true); });
      fetch("/api/dayplan").then((r) => r.json()).then((j) => setReview(j?.review?.text ?? ""), () => {});
    };
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
    if (rec.current || !navigator.mediaDevices?.getUserMedia) return;
    const ctrl = new AbortController();
    let finish = () => {};
    rec.current = { stop: () => finish(), abort: () => ctrl.abort() };
    const done = () => { rec.current = null; setListening(false); dispatchEvent(new Event(VOICE_RESUME)); };
    dispatchEvent(new Event(VOICE_PAUSE)); // "Hey Orbit" lets go of the mic meanwhile
    setListening(true); setMsg(null);
    void (async () => {
      try {
        const audio = await recordUtterance(ctrl.signal, (f) => { finish = f; });
        if (!audio) { setMsg({ ok: false, text: tr("evening.noSpeech") }); return; }
        const said = (await transcribeAudio(audio, ctrl.signal, whisperLang(speechLang()))).trim();
        if (said) setText((t) => `${t}${t && !/\s$/.test(t) ? " " : ""}${said}`.slice(0, ENTRY_MAX));
      } catch (e) {
        if (!ctrl.signal.aborted) setMsg({ ok: false, text: e instanceof DOMException && e.name === "NotAllowedError" ? speechErrorMessage("not-allowed")! : tr("evening.dictStopped") });
      } finally { done(); }
    })();
  };

  const save = async () => {
    stopVoice();
    if (!text.trim() || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/evening", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || tr("eve.saveFail"));
      setText("");
      setMsg({ ok: true, text: tr("eve.saved") });
      setTimeout(() => ref.current?.close(), 1500);
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : tr("eve.saveFail") }); } // the text stays, so nothing is lost
    finally { setBusy(false); }
  };

  return (
    <dialog ref={ref} className="pu pu-modal" data-planet="life" aria-labelledby="evening-title" onClose={() => { rec.current?.abort(); setIsOpen(false); }}
      onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
      <form className="pu-modal-body" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="pu-modal-head">
          <span className="pu-mark" aria-hidden="true" />
          <h2 id="evening-title" className="pu-title">{tr("eve.title")}</h2>
          <Button variant="ghost" icon={<IconClose />} label={tr("eve.close")} onClick={() => ref.current?.close()} />
        </div>
        {review && <p className="pu-modal-note" aria-label={tr("eve.plan")}>{review}</p>}
        <label htmlFor="evening-text" className="pu-modal-label">{tr("eve.prompt")}</label>
        <textarea id="evening-text" className="pu-modal-field evening-text" autoFocus maxLength={ENTRY_MAX} value={text} disabled={busy}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); } }} />
        <div className="pu-modal-actions">
          <Button type="submit" variant="primary" busy={busy} disabled={busy || !text.trim()}>{busy ? tr("eve.saving") : tr("eve.save")}</Button>
          {canVoice && (
            <Button aria-pressed={listening} onClick={listening ? stopVoice : startVoice} disabled={busy}>
              {listening ? tr("eve.stopDict") : tr("eve.dict")}
            </Button>
          )}
          {noLocal && <span className="pu-modal-meta">{tr("evening.noLocal")}</span>}
          <span className="pu-num pu-modal-meta" style={{ marginLeft: "auto" }} aria-hidden>{text.length}/{ENTRY_MAX}</span>
        </div>
        <p className="pu-modal-meta">{tr("eve.keys")}</p>
        {msg && <p className="pu-modal-status" data-bad={msg.ok ? undefined : ""} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
      </form>
    </dialog>
  );
}
