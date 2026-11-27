"use client";
// ORBIT 2 answers on the galaxy home: the big orb above the input thinks, live tool steps stream in real time,
// and the answer streams into this card under it. Follow-ups resume the same ORBIT 2 session.
import { useEffect, useRef, useState } from "react";
import { ACTIVE_CHAT_KEY } from "@/lib/core-chats-pure";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { takeLines } from "@/lib/streamjson";
import { applyLive, type LiveEvent, type LiveRow } from "@/lib/core-live-pure";
import { homeText, startAnswer, statusLine, step, type HomeAnswer as State, type StreamEvent } from "@/lib/home-answer-pure";
import type { DeepLink } from "@/lib/deeplink-pure";
import { ChatAnswer } from "../ChatAnswer";
import { CitedAnswer } from "../CitedAnswer";
import { CoreActivity } from "../CoreActivity";
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
  const [cites, setCites] = useState<{ citations?: Cite[]; trace?: { step: string; cite?: unknown }[] } | null>(null);
  const [rows, setRows] = useState<LiveRow[]>([]);
  const [totalMs, setTotalMs] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [shown, setShown] = useState("");
  const abort = useRef<AbortController | null>(null);
  const since = useRef(Date.now());

  useEffect(() => {
    let state = startAnswer(ask.text, ask.conversationId ?? null);
    let liveRows: LiveRow[] = [];
    since.current = Date.now();
    setS(state); setShown(""); setCites(null); setRows([]); setTotalMs(0);
    const ac = new AbortController();
    abort.current = ac;
    const pacer = createPacer(setShown);
    let navTo: NavTarget | null = null;
    const apply = (ev: StreamEvent & { to?: NavTarget; sessionId?: string }) => {
      const before = state;
      const normalized = ev.sessionId && !ev.conversationId ? { ...ev, conversationId: ev.sessionId } : ev;
      state = step(state, normalized);
      if (state.conversationId && state.conversationId !== before.conversationId) {
        try { localStorage.setItem(ACTIVE_CHAT_KEY, state.conversationId); } catch { /* private mode */ }
        onConversation(state.conversationId);
      }
      if (ev.type === "delta") { pacer.push(state.text); corePhase({ type: "delta" }); }
      else if (ev.type === "reset") pacer.push("");
      else if (ev.type === "step" || ev.type === "step_done") {
        liveRows = applyLive(liveRows, ev as unknown as LiveEvent);
        setRows(liveRows);
        corePhase(ev.type === "step" ? { type: "tool", tool: ev.label || ev.tool || "" } : { type: "tool_end" });
      }
      else if (ev.type === "navigate" && ev.to) navTo = ev.to;
      else if (ev.type === "done" || ev.type === "bg_done") {
        pacer.stop(); setShown(state.text); setTotalMs(Date.now() - since.current); corePhase({ type: "done" }); uiSound("done");
        const d = ev as StreamEvent & { citations?: Cite[]; trace?: { step: string; cite?: unknown }[] };
        setCites({ citations: d.citations, trace: d.trace });
      }
      setS(state);
    };
    corePhase({ type: "submit" });
    void (async () => {
      try {
        const res = await fetch("/api/orbit2", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
          body: JSON.stringify({ message: ask.text, sessionId: ask.conversationId ?? null, lang: getLang() }),
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
        if (state.phase !== "done" && state.phase !== "handed" && state.phase !== "error") throw new Error("Connection to ORBIT 2 was lost");
        if (navTo) dispatchEvent(new CustomEvent(NAV_EVENT, { detail: navTo }));
      } catch (e) {
        if (ac.signal.aborted) { corePhase({ type: "reset" }); return; }
        apply({ type: "error", error: e instanceof Error ? e.message : "ORBIT 2 failed" });
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
  const status = s.phase === "thinking" ? t("homeAns.thinking") : s.phase === "handed" ? t("homeAns.handed") : s.phase === "error" ? (s.error || t("homeAns.failed")) : statusLine(s);
  return (
    <section className="home-answer glass" aria-live="polite" aria-label={t("homeAns.aria")} aria-busy={live}>
      <p className="home-answer-q">{s.q}</p>
      {rows.length > 0 && (
        <CoreActivity rows={rows} running={live} streaming={!!text} since={since.current} totalMs={totalMs} />
      )}
      {text && s.phase !== "error"
        ? <div className="home-answer-a">{s.phase === "done" && !cut ? <CitedAnswer content={text} citations={cites?.citations} trace={cites?.trace} openMemory={onOpenMemory} />
          : <ChatAnswer text={numberCitations(text, [])} streaming={live} />}</div>
        : !rows.length && <p className="home-answer-status" data-phase={s.phase} role={s.phase === "error" ? "alert" : undefined}>{status}</p>}
      <div className="home-answer-actions">
        {live ? <button type="button" className="chip" onClick={() => abort.current?.abort()}>{t("homeAns.stop")}</button>
          : s.phase === "error" ? <button type="button" className="chip" onClick={() => setAttempt((n) => n + 1)}>{t("homeAns.retry")}</button>
          : <button type="button" className="chip" onClick={onContinue}>{t(cut ? "homeAns.readAll" : "homeAns.continue")}</button>}
        {!live && <button type="button" className="chip" onClick={onClose} aria-label={t("homeAns.closeAria")}>{t("common.close")}</button>}
      </div>
    </section>
  );
}
