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
import { getLang } from "../i18n";
import { corePhase } from "./motion";
import { createPacer } from "./stream";

export type HomeAsk = { id: number; text: string; here?: DeepLink | null; conversationId?: string | null };

export function HomeAnswer({ ask, onContinue, onClose, onConversation }: {
  ask: HomeAsk; onContinue: () => void; onClose: () => void; onConversation: (id: string) => void;
}) {
  const [s, setS] = useState<State>(() => startAnswer(ask.text, ask.conversationId ?? null));
  const [shown, setShown] = useState(""); // paced copy of s.text while it streams
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let state = startAnswer(ask.text, ask.conversationId ?? null);
    setS(state); setShown("");
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
      else if (ev.type === "done" || ev.type === "bg_done") { pacer.stop(); setShown(state.text); corePhase({ type: "done" }); }
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
  }, [ask.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
  return (
    <section className="home-answer glass" aria-live="polite" aria-label="CORE's answer">
      <p className="home-answer-q">{s.q}</p>
      {text ? <div className="home-answer-a"><ChatAnswer text={text} streaming={live} /></div>
        : <p className="home-answer-status" data-phase={s.phase}>{statusLine(s)}</p>}
      <div className="home-answer-actions">
        {live ? <button type="button" className="chip" onClick={() => abort.current?.abort()}>Stop</button>
          : <button type="button" className="chip" onClick={onContinue}>{cut ? "Read all in chat" : "Continue in chat"}</button>}
        {!live && <button type="button" className="chip" onClick={onClose} aria-label="Close the answer">Close</button>}
      </div>
    </section>
  );
}
