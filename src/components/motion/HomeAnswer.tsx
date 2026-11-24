"use client";
// CORE answers on the galaxy home (ui-motion): the big orb above the input thinks, and the answer streams into this card under
// it, like the approved motion test. "Continue in chat" opens the same conversation in CORE (it reopens the active chat).
// State rules: lib/home-answer-pure.ts. The orb follows corePhase events, as it does for the CORE drawer.
import { useEffect, useRef, useState } from "react";
import { ACTIVE_CHAT_KEY } from "@/lib/core-chats-pure";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { takeLines } from "@/lib/streamjson";
import { homeText, startAnswer, statusLine, step, type HomeAnswer as State, type StreamEvent } from "@/lib/home-answer-pure";
import type { DeepLink } from "@/lib/deeplink-pure";
import { ChatAnswer } from "../ChatAnswer";
import { CitedAnswer } from "../CitedAnswer";
import { getLang, useT } from "../i18n";
import { numberCitations } from "@/lib/pure";
import type { Cite } from "@/lib/core-cite-pure";
import { corePhase } from "./motion";
import { createPacer } from "./stream";
import { uiSound } from "../ui/sound";

export type HomeAsk = { id: number; text: string; here?: DeepLink | null; conversationId?: string | null };

export function HomeAnswer({ ask, onContinue, onClose, onConversation, onOpenMemory }: {
  ask: HomeAsk; onContinue: () => void; onClose: () => void; onConversation: (id: string) => void; onOpenMemory: (id: string) => void;
}) {
  const { t } = useT();
  const [s, setS] = useState<State>(() => startAnswer(ask.text, ask.conversationId ?? null));
  const [cites, setCites] = useState<{ citations?: Cite[]; trace?: { step: string; cite?: unknown }[] } | null>(null); // the final answer's sources (numbered like in CORE)
  const [attempt, setAttempt] = useState(0); // Try again after an error re-asks the same question
  const [shown, setShown] = useState(""); // paced copy of s.text while it streams
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let state = startAnswer(ask.text, ask.conversationId ?? null);
    setS(state); setShown(""); setCites(null);
    const ac = new AbortController();
    abort.current = ac;
    const pacer = createPacer(setShown);
    let navTo: NavTarget | null = null;
    const apply = (ev: StreamEvent & { to?: NavTarget }) => {
      const before = state;
      state = step(state, ev);
      if (state.conversationId && state.conversationId !== before.conversationId) {
        try { localStorage.setItem(ACTIVE_CHAT_KEY, state.conversationId); } catch { /* private mode */ }
        onConversation(state.conversationId);
      }
      if (ev.type === "delta") { pacer.push(state.text); corePhase({ type: "delta" }); }
      else if (ev.type === "reset") pacer.push("");
      else if (ev.type === "step") corePhase({ type: "tool", tool: ev.label || ev.tool || "" });
      else if (ev.type === "step_done") corePhase({ type: "tool_end" });
      else if (ev.type === "navigate" && ev.to) navTo = ev.to;
      else if (ev.type === "done" || ev.type === "bg_done") {
        pacer.stop(); setShown(state.text); corePhase({ type: "done" }); uiSound("done");
        const d = ev as StreamEvent & { citations?: Cite[]; trace?: { step: string; cite?: unknown }[] };
        setCites({ citations: d.citations, trace: d.trace });
      }
      setS(state);
    };
    corePhase({ type: "submit" });
    void (async () => {
      try {
        const res = await fetch("/api/core?stream=1", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
          body: JSON.stringify({ message: ask.text, conversationId: ask.conversationId ?? null, lang: getLang(), here: ask.here ?? undefined }),
        });
        if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `Request failed (${res.status})`);
        const reader = res.body.getReader(), dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          const { lines, rest } = takeLines(buf + dec.decode(value, { stream: !done }));
          buf = rest;
          for (const l of lines) apply(JSON.parse(l));
          if (done) { if (buf.trim()) apply(JSON.parse(buf)); break; }
        }
        if (state.phase !== "done" && state.phase !== "handed" && state.phase !== "error") throw new Error("Connection to CORE was lost");
        if (navTo) dispatchEvent(new CustomEvent(NAV_EVENT, { detail: navTo })); // after the stream closed, as in the CORE drawer
      } catch (e) {
        if (ac.signal.aborted) { corePhase({ type: "reset" }); return; }
        apply({ type: "error", error: e instanceof Error ? e.message : "CORE failed" });
        corePhase({ type: "error" });
      } finally { pacer.stop(); }
    })();
    return () => ac.abort();
  }, [ask.id, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc stops a streaming answer, then closes the card.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const live = s.phase === "thinking" || s.phase === "tool" || s.phase === "writing";
      if (live) abort.current?.abort(); else onClose();
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [s.phase, onClose]);

  const body = s.phase === "done" ? s.text : shown;
  const { text, cut } = homeText(body);
  const live = s.phase === "thinking" || s.phase === "tool" || s.phase === "writing";
  // Plain words for every state (EN/ET); a failure never shows raw error text: what happened, the question is kept, Try again.
  const status = s.phase === "thinking" ? t("homeAns.thinking") : s.phase === "handed" ? t("homeAns.handed") : s.phase === "error" ? t("homeAns.failed") : statusLine(s);
  return (
    <section className="home-answer glass" aria-live="polite" aria-label={t("homeAns.aria")} aria-busy={live}>
      <p className="home-answer-q">{s.q}</p>
      {text && s.phase !== "error"
        ? <div className="home-answer-a">{s.phase === "done" && !cut ? <CitedAnswer content={text} citations={cites?.citations} trace={cites?.trace} openMemory={onOpenMemory} />
          : <ChatAnswer text={numberCitations(text, [])} streaming={live} />}</div>
        : <p className="home-answer-status" data-phase={s.phase} role={s.phase === "error" ? "alert" : undefined}>{status}</p>}
      <div className="home-answer-actions">
        {live ? <button type="button" className="chip" onClick={() => abort.current?.abort()}>{t("homeAns.stop")}</button>
          : s.phase === "error" ? <button type="button" className="chip" onClick={() => setAttempt((n) => n + 1)}>{t("homeAns.retry")}</button>
          : <button type="button" className="chip" onClick={onContinue}>{t(cut ? "homeAns.readAll" : "homeAns.continue")}</button>}
        {!live && <button type="button" className="chip" onClick={onClose} aria-label={t("homeAns.closeAria")}>{t("common.close")}</button>}
      </div>
    </section>
  );
}
