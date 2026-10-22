"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isSleepCommand } from "./voice/wake";
import { goToSleep } from "./voice/sleep";
import { createClient } from "@/lib/supabase/client";
import { numberCitations } from "@/lib/pure";
import { takeLines } from "@/lib/streamjson";
import { followUps } from "@/lib/core-ui";
import { appendActivity } from "@/lib/core-activity-pure";
import { CoreActivity } from "./CoreActivity";
import { PasswordSection } from "./PasswordSection";
import { ResultEvidence } from "./ResultEvidence";
import type { WriteEvidence } from "@/lib/completion-pure";
import type { Suggestion, InsightAction } from "@/lib/insights-pure";
import type { Plan } from "@/lib/plans-pure";
import { NAV_EVENT, parseNavCommand, type NavTarget } from "@/lib/nav-pure";
import { COMMAND_REPLY_EVENT, runNavCommand } from "./nav-command";
import { KINDS, type Kind } from "@/lib/kinds";
import { Markdown } from "./AgentsPanels";
import { useAttachments, AttachChips, ACCEPT } from "./CoreAttach";
import { BeliefsPanel, takeBeliefsRequest } from "./BeliefsPanel";
import { LifeStats } from "./LifeStats";
import { UsageMeter } from "./UsageMeter";
import { ChatSheet, chatsApi, useCoreChats } from "./CoreChats";
import { ACTIVE_CHAT_KEY, CORE_NEW_CHAT, codeBlocks } from "@/lib/core-chats-pure";
import { sentenceStream, speechChunks } from "./voice/speech-text";
import { CORE_BUSY } from "@/lib/interruption-pure";
import { speakChunk, stop as stopSpeech, speechSettings, takeVoiceAsked, speechGen, onSpeakingChange } from "./voice/speak";

type Memory = { id: string; kind: Kind; title: string; content: string; url: string | null; storage_path: string | null; tags: string[]; created_at: string; updated_at: string; source: string };
type Cite = { id: string; title: string; kind: string };
type Step = { step: string; detail: string; ms: number; ok: boolean; evidence?: WriteEvidence[] };
type Msg = { role: "user" | "assistant"; content: string; citations?: Cite[]; trace?: Step[]; error?: boolean; model?: "fast" | "smart" | "deep"; chips?: string[] };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

/* ---------------- CORE chat ---------------- */
export function CorePanel({ initial, onConsumed, onOpenMemory, greeting, onGreeted }: { initial: string | null; onConsumed: () => void; onOpenMemory: (id: string) => void; greeting?: string | null; onGreeted?: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  // "Orbital wake up" greeting: shown as a CORE bubble only (local state, never sent to /api/core or saved).
  const greeted = useRef<string | null>(null);
  useEffect(() => {
    if (!greeting || greeted.current === greeting) return;
    greeted.current = greeting;
    setMsgs((m) => [...m, { role: "assistant", content: greeting }]);
    onGreeted?.(); // shown once: reopening the panel later starts clean
  }, [greeting]); // eslint-disable-line react-hooks/exhaustive-deps
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { dispatchEvent(new CustomEvent(CORE_BUSY, { detail: busy })); return () => { dispatchEvent(new CustomEvent(CORE_BUSY, { detail: false })); }; }, [busy]);
  const [live, setLive] = useState<string | null>(null); // the answer while it streams in
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => onSpeakingChange(setSpeaking), []);
  const [activity, setActivity] = useState<string[]>([]);
  const [copied, setCopied] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const att = useAttachments(); // files for the next message (📎 / drop / paste)
  const fileRef = useRef<HTMLInputElement>(null);
  const lastQ = useRef(""); // for Retry and ↑ in an empty input
  const convo = useRef<string | null>(null);
  // Saved chats: every message is stored server-side as it is sent; this is just which chat is open.
  const chats = useCoreChats();
  const [chatId, setChatIdState] = useState<string | null>(null);
  const [newProject, setNewProject] = useState<string | null>(null); // project picked for a chat that has no messages yet
  const [sheet, setSheet] = useState(false);
  const [pinned, setPinned] = useState("");
  const opening = useRef(0); // bumped by every switch/new chat/send: a slow openChat that lost the race is dropped
  const setChatId = useCallback((id: string | null) => {
    convo.current = id;
    setChatIdState(id);
    try { if (id) localStorage.setItem(ACTIVE_CHAT_KEY, id); else localStorage.removeItem(ACTIVE_CHAT_KEY); } catch { /* private mode */ }
  }, []);
  const newChat = useCallback((projectId: string | null = null) => {
    abort.current?.abort(); stopSpeech();
    opening.current++;
    setMsgs([]); setChatId(null); setNewProject(projectId); setSheet(false); lastQ.current = "";
  }, [setChatId]);
  const openChat = useCallback(async (id: string) => {
    setSheet(false);
    if (id === convo.current) return;
    abort.current?.abort(); stopSpeech();
    const mine = ++opening.current;
    try {
      const r = await chatsApi<{ messages: Msg[] }>(undefined, `?id=${encodeURIComponent(id)}`);
      if (mine !== opening.current) return;
      if (!r.messages.length) { newChat(); return; } // deleted (or not this user's): start fresh
      setMsgs(r.messages.map((m) => ({ role: m.role, content: m.content, citations: m.citations, trace: m.trace })));
      setChatId(id); setNewProject(null);
      lastQ.current = [...r.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    } catch (e) { if (mine === opening.current) { setMsgs([{ role: "assistant", content: e instanceof Error ? e.message : "Couldn't open that chat", error: true }]); setChatId(null); } }
  }, [setChatId, newChat]);
  // Reopen the last chat on mount (the panel remounts each time it opens); palette/voice "new chat" starts fresh.
  useEffect(() => {
    let last: string | null = null;
    try { last = localStorage.getItem(ACTIVE_CHAT_KEY); } catch { /* private mode */ }
    if (last && !initial && !greeting) void openChat(last);
    const h = () => newChat();
    addEventListener(CORE_NEW_CHAT, h);
    return () => removeEventListener(CORE_NEW_CHAT, h);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const project = (chatId ? chats.map[chatId] : null) ?? newProject; // newProject covers a just-created chat before the list reloads
  const pin = async (text: string, title?: string) => {
    if (!project) return;
    if (await chats.act({ action: "pin", projectId: project, text: text.replace(/\s*\[[ma]:[^\]]+\]/g, ""), title })) { setPinned(text); setTimeout(() => setPinned(""), 1500); }
  };
  const end = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  // Abort a running answer only on a real unmount: React dev mode unmounts and remounts once right away,
  // which used to cancel the command-bar question instantly ("Stopped.").
  const alive = useRef(false);
  const flying = useRef(false); // a navigation (ours or Orbit's voice path) is taking us away: let the spoken reply finish
  useEffect(() => {
    const h = (e: Event) => { const t = (e as CustomEvent<NavTarget>).detail; flying.current = t.panel !== "core" && !t.zoom; };
    addEventListener(NAV_EVENT, h);
    return () => removeEventListener(NAV_EVENT, h);
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; const ac = abort.current; setTimeout(() => { if (!alive.current) { ac?.abort(); if (!flying.current) stopSpeech(); } }, 0); };
  }, []);

  const send = useCallback(async (text: string, fromVoice?: boolean) => {
    const message = text.trim();
    const nav = parseNavCommand(message, { current: "core" });
    if ((!message && !att.has()) || (busy && !nav)) return; // direct commands still work while CORE answers
    stopSpeech();
    if (isSleepCommand(message)) { void goToSleep(); return; }
    opening.current++; // sending wins over a chat still loading
    if (/^(start (a )?)?new (chat|conversation)[.!]?$/i.test(message) && !att.has()) { newChat(); return; }
    // Speak only answers to spoken questions; settings are re-read per chunk so toggling takes effect live.
    let myGen = speechGen(); // a later stop() (barge-in, Stop button) silences the rest of this answer
    const talk = fromVoice || takeVoiceAsked();
    const say = (parts: string[]) => { if (talk && speechSettings().speak) parts.forEach((p) => speakChunk(p, myGen)); };
    const voiceOut = sentenceStream();
    const fly = (to: NavTarget) => dispatchEvent(new CustomEvent(NAV_EVENT, { detail: to }));
    const files = nav ? [] : att.take(); // pending attachments must not send a direct command to Claude
    setMsgs((m) => [...m, { role: "user", content: [message, files.length && `📎 ${files.map((f) => f.name).join(", ")}`].filter(Boolean).join("\n") }]);
    setInput("");
    lastQ.current = message;
    if (nav) {
      try {
        const reply = await runNavCommand(nav);
        dispatchEvent(new CustomEvent(COMMAND_REPLY_EVENT, { detail: reply })); // visible even when navigation closes CORE
        setMsgs((m) => [...m, { role: "assistant", content: reply }]); say([reply]);
      } catch (e) { setMsgs((m) => [...m, { role: "assistant", content: e instanceof Error ? e.message : "Command failed. Try again.", error: true }]); }
      finally { if (talk) dispatchEvent(new Event("orbit:core-done")); }
      return;
    }
    setBusy(true);
    setActivity([]);
    const ac = new AbortController();
    abort.current = ac;
    let partial = "";
    let navTo: NavTarget | null = null; // CORE's navigate tool: fly once the answer is done, so leaving the panel can't cut it off
    let raf = 0;
    const flush = () => { cancelAnimationFrame(raf); raf = 0; };
    try {
      const res = await fetch("/api/core?stream=1", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
        body: JSON.stringify({ message, conversationId: convo.current, projectId: convo.current ? undefined : newProject ?? undefined, voice: talk, attachments: files.length ? files.map((f) => ({ name: f.name, data: f.data })) : undefined }),
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let finished = false;
      const handle = (line: string) => {
        const ev = JSON.parse(line) as { type: string; conversationId?: string; text?: string; answer?: string; citations?: Cite[]; trace?: Step[]; error?: string; to?: NavTarget; label?: string; model?: "fast" | "smart" | "deep" };
        if (ev.conversationId && ev.conversationId !== convo.current) { setChatId(ev.conversationId); void chats.reload(); }
        if (ev.type === "delta" && ev.text) {
          partial += ev.text;
          say(voiceOut.push(ev.text));
          // One render per frame at most, and only the streaming bubble changes.
          if (!raf) raf = requestAnimationFrame(() => { raf = 0; setLive(partial); });
        } else if (ev.type === "step" && ev.label) {
          setActivity((labels) => appendActivity(labels, ev.label!));
        } else if (ev.type === "navigate" && ev.to) {
          navTo = ev.to;
        } else if (ev.type === "reset") {
          partial = "";
          voiceOut.reset();
          if (talk && speechGen() === myGen) { stopSpeech(); myGen = speechGen(); } // restart, unless the user already silenced it
          setLive("");
        } else if (ev.type === "done") {
          finished = true;
          flush();
          // The final answer equals the streamed text up to citation markers (stripped for speech): speak only the tail.
          say(partial.trim() ? voiceOut.flush() : speechChunks(ev.answer ?? ""));
          setLive(null);
          setMsgs((m) => [...m, { role: "assistant", content: ev.answer ?? "", citations: ev.citations, trace: ev.trace, model: ev.model,
            chips: followUps(message, (ev.trace ?? []).map((s) => s.step)) }]);
        } else if (ev.type === "error") {
          throw new Error(ev.error || "CORE failed");
        }
      };
      for (;;) {
        const { value, done } = await reader.read();
        const { lines, rest } = takeLines(buf + dec.decode(value, { stream: !done }));
        buf = rest;
        lines.forEach(handle);
        if (done) { if (buf.trim()) handle(buf); break; }
      }
      if (!finished) throw new Error("Connection to CORE was lost");
      if (navTo) fly(navTo); // after the stream closed: leaving the panel aborts the request, which mustn't land mid-read
    } catch (e) {
      const stopped = ac.signal.aborted;
      if (talk) stopSpeech();
      if (!stopped) ac.abort(); // e.g. a malformed line: stop the server-side CLI too
      setMsgs((m) => [...m, stopped
        ? { role: "assistant", content: `${partial}${partial ? "\n\n" : ""}_Stopped._` }
        : { role: "assistant", content: e instanceof Error ? e.message : "CORE failed", error: true }]);
    } finally {
      flush();
      setLive(null);
      setActivity([]);
      setBusy(false);
      if (abort.current === ac) abort.current = null;
      if (talk) dispatchEvent(new Event("orbit:core-done")); // voice conversation listens again only after this (bus.ts CORE_DONE)
      void chats.reload(); // Recents order + title
    }
  }, [busy, newProject, newChat, setChatId, chats.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  // While CORE is open: Ctrl/⌘+K focuses its input (capture phase + preventDefault, so Orbit's command-bar shortcut skips it)
  // and Esc stops a streaming answer instead of closing the panel.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return; // VoiceControls already used this Esc (both listen in the capture phase)
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") { e.preventDefault(); inputRef.current?.focus(); }
      else if (e.key === "Escape" && busy) { e.preventDefault(); e.stopPropagation(); abort.current?.abort(); stopSpeech(); }
    };
    addEventListener("keydown", h, true);
    return () => removeEventListener("keydown", h, true);
  }, [busy]);

  // React dev mode runs effects twice; remember what we already sent so the command bar message goes out once.
  const sentInitial = useRef<string | null>(null);
  const queued = useRef<string | null>(null);
  useEffect(() => {
    if (!initial) { sentInitial.current = null; return; }
    if (sentInitial.current === initial) return;
    sentInitial.current = initial;
    onConsumed();
    // Busy: never drop the new question (e.g. a voice follow-up). Stop the running answer and send it once that settles.
    if (busy) { queued.current = initial; abort.current?.abort(); }
    else void send(initial);
  }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (busy || !queued.current) return;
    const q = queued.current;
    queued.current = null;
    void send(q);
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, busy, live]);

  // Memoised so streaming deltas re-render only the live bubble, not the whole history.
  const history = useMemo(() => msgs.map((m, i) => (
    <div key={i} className={m.role === "user" ? "bubble user" : `bubble core${m.error ? " err" : ""}`}>
      {m.role === "assistant" && !m.error
        ? <Markdown text={numberCitations(m.content, (m.citations ?? []).map((c) => c.id))} openMemory={onOpenMemory} />
        : <div className="whitespace-pre-wrap">{m.content}</div>}
      {!!m.citations?.length && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {m.citations.map((c, n) => <button key={c.id} className="chip" onClick={() => onOpenMemory(c.id)}>[{n + 1}] {c.title}</button>)}
        </div>
      )}
      {m.role === "assistant" && (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
          {!m.error && <>
            <button type="button" className="chip" aria-label={copied === i ? "Copied" : "Copy answer"} title="Copy"
              onClick={() => { void navigator.clipboard?.writeText(m.content.replace(/\s*\[[ma]:[^\]]+\]/g, "")).then(() => { setCopied(i); setTimeout(() => setCopied((c) => (c === i ? -1 : c)), 1500); }); }}>
              {copied === i ? "✓ Copied" : "Copy"}
            </button>
            <button type="button" className="chip" aria-label={speaking ? "Stop speaking" : "Read aloud"} title={speaking ? "Stop speaking" : "Read aloud"}
              onClick={() => { const was = speaking; stopSpeech(); if (!was) speechChunks(m.content).forEach((c) => speakChunk(c)); }}>
              {speaking ? "■ Stop" : "🔊 Read aloud"}
            </button>
            <button type="button" className="chip" disabled={!project} title={project ? "Pin this reply to the project" : "Move this chat into a project to pin replies"}
              onClick={() => void pin(m.content)}>{pinned === m.content ? "✓ Pinned" : "📌 Pin"}</button>
            {project && codeBlocks(m.content) && (
              <button type="button" className="chip" title="Pin only the code blocks to the project" onClick={() => void pin(codeBlocks(m.content), `Code: ${chats.chats.find((c) => c.id === chatId)?.title ?? "chat"}`.slice(0, 100))}>
                {pinned === codeBlocks(m.content) ? "✓ Pinned" : "📌 Pin code"}</button>
            )}
          </>}
          {i === msgs.length - 1 && lastQ.current && !busy && (
            <button type="button" className="chip" title="Ask the last question again" onClick={() => void send(lastQ.current)}>↻ Retry</button>
          )}
          {m.model && <span className="muted ml-auto opacity-60" title={m.model === "fast" ? "Quick reply from the fast model" : m.model === "deep" ? (m.trace?.some((x) => x.step === "review") ? "Deep answer: planned, then self-checked by the strongest model" : "Deep answer from the strongest model") : "Answered by the main model"}>{m.model}</span>}
        </div>
      )}
      {!busy && i === msgs.length - 1 && !!m.chips?.length && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Suggested follow-ups">
          {m.chips.map((c) => <button key={c} type="button" className="chip" onClick={() => void send(c)}>{c}</button>)}
        </div>
      )}
      {!!m.trace?.length && (
        <ResultEvidence items={m.trace.flatMap((s) => s.evidence ?? [])} openMemory={onOpenMemory} />
      )}
      {!!m.trace?.length && (
        <details className="mt-2 text-xs muted">
          <summary className="cursor-pointer">Execution trace</summary>
          <ul className="mt-1 space-y-0.5">{m.trace.map((s, n) => <li key={n}>{s.ok ? "✓" : "✗"} <b>{s.step}</b> · {s.ms}ms · {s.detail}</li>)}</ul>
        </details>
      )}
    </div>
  )), [msgs, onOpenMemory, speaking, copied, busy, send, project, pinned]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative flex h-full flex-col" onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); void att.add(e.dataTransfer.files); } }}>
      <div className="mb-2 flex items-center gap-1.5 text-xs">
        <button type="button" className="chip" aria-expanded={sheet} onClick={() => setSheet((v) => !v)} title="Chats and projects">☰ Chats</button>
        <span className="min-w-0 flex-1 truncate font-semibold">{chatId ? chats.chats.find((c) => c.id === chatId)?.title ?? "Chat" : "New chat"}</span>
        <span className="muted shrink-0" aria-live="polite">{busy ? "Saving…" : chatId ? "✓ Saved" : ""}</span>
        {!!chats.projects.length && (
          <select className="field max-w-[8rem] py-1 text-xs" aria-label="Project for this chat" value={project ?? ""}
            onChange={(e) => { const v = e.target.value || null; setNewProject(v); if (chatId) void chats.act({ action: "move", id: chatId, projectId: v }); }}>
            <option value="">No project</option>
            {chats.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <button type="button" className="chip" onClick={() => newChat()} disabled={!msgs.length && !chatId} title="Start a new chat">＋ New</button>
      </div>
      {chats.error && !sheet && <p className="error mb-2 text-xs" role="alert">{chats.error}</p>}
      {sheet && <ChatSheet {...chats} activeId={chatId} onOpen={(id) => void openChat(id)} onNew={newChat} onClose={() => setSheet(false)}
        onDeleted={(id) => { if (id === chatId) newChat(); }} />}
      <CoreSuggests tick={msgs.length} />
      <PlanCard tick={msgs.length} />
      <div className="flex-1 space-y-4 overflow-y-auto pr-1" aria-live="polite" aria-busy={busy}>
        {!msgs.length && <p className="muted">Ask CORE anything. It answers from your memories, reads links you paste, checks the latest news, and hands bigger jobs to your agents. Sources are cited.</p>}
        {history}
        {busy && <CoreActivity labels={activity} streaming={!!live} />}
        {busy && live && <div className="bubble core">
              {/* Citation numbers arrive with the final answer; hide raw [m:id] markers until then. */}
              <Markdown text={numberCitations(live, [])} openMemory={onOpenMemory} />
              <span aria-hidden className="inline-block h-4 w-1.5 translate-y-0.5 rounded-sm bg-current opacity-60" style={{ animation: "blink 1s steps(2) infinite" }} />
            </div>}
        <div ref={end} />
      </div>
      <AttachChips items={att.items} error={att.error} onRemove={att.remove} />
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <input ref={fileRef} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { if (e.target.files) void att.add(e.target.files); e.target.value = ""; }} />
        <button type="button" className="btn" title="Attach images or documents (or drop / paste them)" aria-label="Attach files" disabled={busy} onClick={() => fileRef.current?.click()}>📎</button>
        <input ref={inputRef} className="field flex-1" value={input} onChange={(e) => setInput(e.target.value)} onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); void att.add(e.clipboardData.files); } }} placeholder="Message CORE  (↑ last question · Esc stops)"
          onKeyDown={(e) => { if (e.key === "ArrowUp" && !input && lastQ.current) { e.preventDefault(); setInput(lastQ.current); } }} maxLength={8000} aria-label="Message CORE" />
        {busy
          ? <button type="button" className="btn" onClick={() => { abort.current?.abort(); stopSpeech(); }}>Stop</button>
          : speaking && !input.trim()
            ? <button type="button" className="btn" onClick={stopSpeech}>Stop</button>
            : <button className="btn" disabled={!input.trim() && !att.items.length}>Send</button>}
      </form>
    </div>
  );
}

/** "CORE suggests": up to 3 proactive suggestions (src/lib/insights-pure.ts), each with its one-click action and dismiss. */
function CoreSuggests({ tick }: { tick: number }) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [busyKey, setBusyKey] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(() => { api<{ items: Suggestion[] }>("/api/insights").then((r) => setItems(r.items), () => {}); }, []);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load, tick]);
  const mark = (key: string, op: "dismiss" | "done") => api("/api/insights", { method: "POST", body: JSON.stringify({ key, op }) }).catch(() => {}).finally(load);
  const run = async (s: Suggestion, a: InsightAction) => {
    setBusyKey(s.key); setErr("");
    try {
      for (const p of a.post ?? []) {
        const u = new URL(p.url, location.origin); // only our own STUDIO routes
        if (u.origin !== location.origin || !u.pathname.startsWith("/api/studio/") || /\.\.|%2e/i.test(p.url)) throw new Error("Unexpected action");
        await api(u.pathname + u.search, { method: "POST", body: JSON.stringify(p.body ?? {}) });
      }
      if (a.nav) dispatchEvent(new CustomEvent(NAV_EVENT, { detail: a.nav }));
      await mark(s.key, "done");
    } catch (e) { setErr(`${a.label}: ${e instanceof Error ? e.message : "failed"}`); }
    setBusyKey("");
  };
  if (!items.length) return null;
  return (
    <section className="mb-3 space-y-1.5" aria-label="CORE suggests">
      <div className="muted text-xs uppercase tracking-wide">CORE suggests</div>
      {items.slice(0, 3).map((s) => (
        <div key={s.key} className="glass flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm">
          <span className="min-w-0 flex-1" title={s.detail}>{s.priority === "high" && <span aria-label="Important">● </span>}{s.title}</span>
          {s.actions.map((a) => <button key={a.label} type="button" className="chip" disabled={!!busyKey} onClick={() => void run(s, a)}>{busyKey === s.key ? "…" : a.label}</button>)}
          <button type="button" className="chip" aria-label={`Dismiss: ${s.title}`} title="Dismiss" disabled={!!busyKey} onClick={() => void mark(s.key, "dismiss")}>✕</button>
        </div>
      ))}
      {err && <p className="text-xs text-red-400" role="alert">{err}</p>}
    </section>
  );
}

/** A CORE plan's progress ("Step 2/4: rendering… 62%"), the OK button for scheduling steps, and Cancel. */
function PlanCard({ tick }: { tick: number }) {
  const [plan, setPlan] = useState<(Plan & { line: string }) | null>(null);
  const [err, setErr] = useState("");
  const active = plan?.status === "running" || plan?.status === "waiting";
  const load = useCallback(() => { api<{ plan: (Plan & { line: string }) | null }>("/api/plans").then((r) => setPlan(r.plan), () => {}); }, []);
  useEffect(() => { load(); const t = setInterval(load, active ? 4000 : 30_000); return () => clearInterval(t); }, [load, active, tick]);
  const act = (op: "confirm" | "cancel") => {
    if (!plan) return;
    setErr("");
    api<{ plan: Plan & { line: string } }>("/api/plans", { method: "POST", body: JSON.stringify({ id: plan.id, op, step: plan.current }) })
      .then((r) => setPlan(r.plan), (e) => setErr(e instanceof Error ? e.message : "failed"));
  };
  if (!plan || (!active && Date.now() - Date.parse(plan.updatedAt) > 10 * 60_000)) return null;
  return (
    <section className="glass mb-3 rounded-lg px-3 py-2 text-sm" aria-label="CORE plan" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <b className="min-w-0 flex-1">{plan.goal}</b>
        {plan.status === "waiting" && <button type="button" className="btn" onClick={() => act("confirm")}>OK, schedule</button>}
        {active && <button type="button" className="chip" onClick={() => act("cancel")}>Cancel</button>}
      </div>
      <div className={plan.status === "failed" ? "mt-1 text-red-400" : "muted mt-1"}>{plan.line}</div>
      {err && <p className="text-xs text-red-400" role="alert">{err}</p>}
    </section>
  );
}

/* ---------------- MEMORY ---------------- */
type LinkRow = { id: string; status: string; score: number | null; from: { id: string; title: string } | null; to: { id: string; title: string } | null };

export function MemoryPanel({ focusId, onChanged }: { focusId: string | null; onChanged: () => void }) {
  const [items, setItems] = useState<Memory[]>([]);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<Memory | null>(null);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [form, setForm] = useState({ kind: "note" as Kind, title: "", content: "", url: "", tags: "" });
  const [saving, setSaving] = useState(false);
  const [learnedOnly, setLearnedOnly] = useState(false);
  const [beliefs, setBeliefs] = useState(false);
  useEffect(() => {
    if (takeBeliefsRequest()) setBeliefs(true); // "what do you know about me" opened MEMORY
    const h = (e: Event) => { if ((e as CustomEvent<NavTarget>).detail?.beliefs) { takeBeliefsRequest(); setBeliefs(true); } };
    addEventListener(NAV_EVENT, h);
    return () => removeEventListener(NAV_EVENT, h);
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setSaving(true); setErr(""); setNote("");
    try {
      const fd = new FormData();
      fd.set("file", file);
      if (form.title.trim()) fd.set("title", form.title.trim());
      if (form.content.trim()) fd.set("note", form.content.trim());
      if (form.tags.trim()) fd.set("tags", form.tags);
      const res = await fetch("/api/memories/upload", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Upload failed (${res.status})`);
      setNote(`Saved ${file.name}${json.extractedChars ? ` (${json.extractedChars.toLocaleString()} characters of text read)` : ""}.`);
      setForm({ ...form, title: "", content: "", url: "", tags: "" });
      await Promise.all([load(q), loadLinks()]); onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
    finally { setSaving(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  const load = useCallback(async (query: string) => {
    try {
      const r = await api<{ results: Memory[]; mode: string }>(`/api/memories${query ? `?q=${encodeURIComponent(query)}` : ""}`);
      setItems(r.results); setMode(r.mode); setErr("");
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load"); }
  }, []);
  const loadLinks = useCallback(async () => {
    try { setLinks((await api<{ links: LinkRow[] }>("/api/links")).links); } catch { /* shown via main error on next load */ }
  }, []);

  useEffect(() => { void load(""); void loadLinks(); }, [load, loadLinks]);
  useEffect(() => {
    if (!focusId) return;
    api<{ memory: Memory }>(`/api/memories/${focusId}`).then((r) => setOpen(r.memory)).catch((e) => setErr(e.message));
  }, [focusId]);

  async function capture(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(""); setNote("");
    try {
      const r = await api<{ embedded: boolean; suggested: number }>("/api/memories", { method: "POST", body: JSON.stringify(form) });
      setNote(`Saved.${r.suggested ? ` ${r.suggested} related memories suggested below.` : ""}${r.embedded ? "" : " (keyword search only; no embeddings configured)"}`);
      setForm({ ...form, title: "", content: "", url: "", tags: "" });
      await Promise.all([load(q), loadLinks()]); onChanged();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not save"); }
    finally { setSaving(false); }
  }

  async function saveEdit() {
    if (!open) return;
    try {
      await api(`/api/memories/${open.id}`, { method: "PATCH", body: JSON.stringify({ title: open.title, content: open.content, tags: open.tags }) });
      setOpen(null); await load(q); onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not update"); }
  }
  async function remove() {
    if (!open || !confirm(`Delete "${open.title}"? This can't be undone.`)) return;
    try { await api(`/api/memories/${open.id}`, { method: "DELETE" }); setOpen(null); await Promise.all([load(q), loadLinks()]); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not delete"); }
  }
  async function decide(id: string, status: "confirmed" | "rejected") {
    try { await api("/api/links", { method: "PATCH", body: JSON.stringify({ id, status }) }); await loadLinks(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not update link"); }
  }

  const suggested = links.filter((l) => l.status === "suggested");
  const shown = learnedOnly ? items.filter((m) => isLearned(m.source)) : items;

  if (beliefs) return <BeliefsPanel onBack={() => setBeliefs(false)} />;
  if (open) {
    return (
      <div className="space-y-3">
        <button className="link" onClick={() => setOpen(null)}>← Back</button>
        <input className="field w-full" value={open.title} onChange={(e) => setOpen({ ...open, title: e.target.value })} aria-label="Title" />
        <textarea className="field h-56 w-full" value={open.content} onChange={(e) => setOpen({ ...open, content: e.target.value })} aria-label="Content" />
        <input className="field w-full" value={open.tags.join(", ")} onChange={(e) => setOpen({ ...open, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} placeholder="tags, comma separated" aria-label="Tags" />
        <p className="muted text-xs">{open.kind} · source: {open.source}{open.url && <> · <a className="link" href={open.url} target="_blank" rel="noreferrer noopener">open link</a></>}{open.storage_path && <> · <a className="link" href={`/api/memories/${open.id}/file`} target="_blank" rel="noreferrer">open file</a></>} · created {when(open.created_at)} · updated {when(open.updated_at)}</p>
        {err && <p className="error">{err}</p>}
        <div className="flex gap-2"><button className="btn" onClick={saveEdit}>Save</button><button className="btn danger" onClick={remove}>Delete</button></div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <form onSubmit={capture} className="space-y-2">
        <h3 className="h3">Capture</h3>
        <textarea className="field h-24 w-full" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Anything worth remembering…" aria-label="Content" maxLength={200000} />
        <div className="flex gap-2">
          <input className="field flex-1" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title (optional)" aria-label="Title" maxLength={300} />
          <select className="field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })} aria-label="Kind">{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
        </div>
        <div className="flex gap-2">
          <input className="field flex-1" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="Link to save (https://…)" aria-label="URL" />
          <input className="field flex-1" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="tags" aria-label="Tags" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" disabled={saving || (!form.content.trim() && !form.url.trim() && !form.title.trim())}>{saving ? "Saving…" : "Save to memory"}</button>
          <label className={`chip cursor-pointer${saving ? " opacity-50" : ""}`}>
            Upload file
            <input ref={fileRef} type="file" className="sr-only" disabled={saving}
              accept=".pdf,.docx,.txt,.md,.csv,image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          </label>
          <span className="muted text-xs">PDF, Word, text, images · max 4 MB</span>
        </div>
        {note && <p className="ok">{note}</p>}
        {err && <p className="error">{err}</p>}
      </form>

      {!!suggested.length && (
        <div>
          <h3 className="h3">Suggested connections</h3>
          <p className="muted text-xs">Found by similarity. Nothing is linked until you confirm.</p>
          <ul className="mt-2 space-y-2">
            {suggested.map((l) => (
              <li key={l.id} className="card text-sm">
                <button className="link text-left" onClick={() => l.from && setFocus(l.from.id)}>{l.from?.title}</button> ↔ <button className="link text-left" onClick={() => l.to && setFocus(l.to.id)}>{l.to?.title}</button>
                <span className="muted"> · {Math.round((l.score ?? 0) * 100)}%</span>
                <div className="mt-1 flex gap-2"><button className="chip" onClick={() => decide(l.id, "confirmed")}>Confirm</button><button className="chip" onClick={() => decide(l.id, "rejected")}>Dismiss</button></div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between"><h3 className="h3">Memories</h3><span className="flex gap-3"><button type="button" className="link text-xs" onClick={() => setBeliefs(true)}>What ORBIT believes</button><a className="link text-xs" href="/api/export">Export JSON</a></span></div>
        <form className="my-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void load(q.trim()); }}>
          <input className="field flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your memory" aria-label="Search memories" />
          <button className="btn">Search</button>
        </form>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button type="button" className="chip" aria-pressed={learnedOnly} onClick={() => setLearnedOnly(!learnedOnly)}>Learned by CORE</button>
          {q.trim() && mode && <span className="muted text-xs">{mode === "hybrid" ? "Keyword + semantic search" : "Keyword search"}</span>}
        </div>
        <ul className="space-y-2">
          {shown.map((m) => (
            <li key={m.id}>
              <button className="card w-full text-left" onClick={() => setOpen(m)}>
                <div className="font-medium">{m.title}{isLearned(m.source) && <span className="badge learned ml-2 align-middle">LEARNED BY CORE</span>}</div>
                <div className="muted line-clamp-2 text-xs">{m.content.slice(0, 200)}</div>
                <div className="muted mt-1 text-[11px]">{m.kind} · {when(m.created_at)}{m.tags.length ? ` · ${m.tags.map((t) => `#${t}`).join(" ")}` : ""}</div>
              </button>
            </li>
          ))}
          {!shown.length && !err && <li className="muted">{learnedOnly ? "CORE hasn't saved anything by itself here yet." : q.trim() ? "Nothing matched." : "No memories yet. Capture your first one above."}</li>}
        </ul>
      </div>
    </div>
  );

  function setFocus(id: string) {
    api<{ memory: Memory }>(`/api/memories/${id}`).then((r) => setOpen(r.memory)).catch((e) => setErr(e.message));
  }
}

/* ---------------- PROFILE ---------------- */
const isLearned = (source: string | null | undefined) => source === "core" || source === "core-auto" || source === "core-summary";
const LIST_FIELDS = [["interests", "Interests"], ["projects", "Current projects"], ["goals", "Goals"], ["news_topics", "Preferred news topics"], ["research_priorities", "Research priorities"]] as const;

export function ProfilePanel() {
  const [p, setP] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  useEffect(() => {
    api<{ profile: Record<string, unknown> | null }>("/api/profile").then(({ profile }) => {
      const o: Record<string, string> = { display_name: String(profile?.display_name ?? ""), communication: String(profile?.communication ?? "") };
      for (const [k] of LIST_FIELDS) o[k] = ((profile?.[k] as string[] | undefined) ?? []).join(", ");
      setP(o);
    }).catch((e) => setMsg(e.message));
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try { await api("/api/profile", { method: "PUT", body: JSON.stringify(p) }); setMsg("Saved."); } catch (e2) { setMsg(e2 instanceof Error ? e2.message : "Could not save"); }
  }
  return (
    <div className="space-y-6">
    <form onSubmit={save} className="space-y-3">
      <p className="muted text-sm">CORE reads this. Only what you write here is used; ORBIT never turns guesses into profile facts.</p>
      <label className="block text-sm">Name<input className="field mt-1 w-full" value={p.display_name ?? ""} onChange={(e) => setP({ ...p, display_name: e.target.value })} /></label>
      {LIST_FIELDS.map(([k, label]) => (
        <label key={k} className="block text-sm">{label} <span className="muted">(comma separated)</span>
          <input className="field mt-1 w-full" value={p[k] ?? ""} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></label>
      ))}
      <label className="block text-sm">How CORE should talk to you<textarea className="field mt-1 h-20 w-full" value={p.communication ?? ""} onChange={(e) => setP({ ...p, communication: e.target.value })} maxLength={1000} /></label>
      <button className="btn">Save profile</button> {msg && <span className="muted text-sm">{msg}</span>}
    </form>
    <PasswordSection />
    <PlaybookSection />
    </div>
  );
}

type PlaybookData = { available: boolean; message?: string; rules: string[]; version: number; history: { version: number; rules: string[]; source: string; at: string }[] };
const sourceLabel = (s: string) => (s.startsWith("user") ? "you" + (s === "user:clear" ? " (cleared)" : "") : s.startsWith("revert") ? `revert to ${s.slice(7)}` : "CORE");

function PlaybookSection() {
  const [d, setD] = useState<PlaybookData | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [add, setAdd] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const apply = (r: PlaybookData) => { setD(r); setDraft(r.rules); };

  useEffect(() => { api<PlaybookData>("/api/playbook").then(apply).catch((e) => setMsg(e.message)); }, []);

  async function post(body: object, done = "Saved.") {
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/playbook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: d?.version, ...body }) });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409) { apply(await api<PlaybookData>("/api/playbook")); setMsg(json.error || "CORE updated the rules meanwhile. Reloaded."); return false; }
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      apply(json as PlaybookData); setMsg(done); return true;
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save"); return false; }
    finally { setBusy(false); }
  }

  const dirty = !!d && JSON.stringify(draft) !== JSON.stringify(d.rules);
  return (
    <section className="space-y-2" aria-labelledby="playbook-h">
      <h3 id="playbook-h" className="h3">How CORE has adapted</h3>
      <p className="muted text-xs">CORE learns from your chats by saving memories and updating these rules. It doesn&apos;t retrain its underlying model. Rules can only be about answer style (length, tone, format, language), never tools, data, links or approvals, and you can edit or remove any of them.</p>
      {d && !d.available ? <p className="muted text-sm">{d.message}</p> : !d ? (!msg && <p className="muted text-sm">Loading…</p>) : (
        <>
          <ul className="space-y-2">
            {draft.map((r, i) => (
              <li key={i} className="flex gap-2">
                <input className="field flex-1 text-sm" value={r} maxLength={200} aria-label={`Rule ${i + 1}`} disabled={busy}
                  onChange={(e) => setDraft(draft.map((x, j) => (j === i ? e.target.value : x)))}
                  onKeyDown={(e) => { if (e.key === "Enter" && dirty) void post({ action: "set", rules: draft }); }} />
                <button type="button" className="chip" disabled={busy} aria-label={`Delete rule ${i + 1}`} onClick={() => post({ action: "set", rules: draft.filter((_, j) => j !== i) }, "Rule removed.")}>Delete</button>
              </li>
            ))}
            {!draft.length && <li className="muted text-sm">No learned rules yet. CORE adds them when it notices how you like things done.</li>}
          </ul>
          {dirty && <div className="flex gap-2"><button type="button" className="btn" disabled={busy} onClick={() => post({ action: "set", rules: draft })}>Save changes</button><button type="button" className="chip" onClick={() => setDraft(d.rules)}>Undo edits</button></div>}
          <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (add.trim() && await post({ action: "set", rules: [...draft, add] }, "Rule added.")) setAdd(""); }}>
            <input className="field flex-1 text-sm" value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Add a rule, e.g. Answer in short bullet points" maxLength={200} aria-label="New rule" disabled={busy || draft.length >= 30} />
            <button className="btn" disabled={busy || !add.trim() || draft.length >= 30}>Add</button>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            {!!d.rules.length && <button type="button" className="chip" disabled={busy} onClick={() => confirm("Remove all learned rules? You can revert from history.") && post({ action: "clear" }, "Cleared.")}>Clear all</button>}
            {d.version > 0 && <span className="muted text-xs">Version {d.version}</span>}
          </div>
          {d.history.length > 1 && (
            <details className="learn-history">
              <summary className="link text-xs">Previous versions</summary>
              <ul className="mt-2 space-y-1">
                {d.history.filter((h) => h.version !== d.version).map((h) => (
                  <li key={h.version} className="flex items-center justify-between gap-2 text-xs">
                    <span className="muted" title={h.rules.join("\n") || "(no rules)"}>v{h.version} · {sourceLabel(h.source)} · {h.rules.length} rule{h.rules.length === 1 ? "" : "s"} · {when(h.at)}</span>
                    <button type="button" className="chip" disabled={busy} onClick={() => post({ action: "revert", version: h.version }, `Reverted to v${h.version}.`)}>Revert</button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {msg && <p className="muted text-sm" role="status">{msg}</p>}
    </section>
  );
}

/* ---------------- ANALYTICS (real counts) ---------------- */
export function AnalyticsPanel() {
  const sb = useMemo(() => createClient(), []);
  const [s, setS] = useState<{ memories: number; messages: number; calls: number; tokens: number; events: { type: string; created_at: string }[] } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    (async () => {
      const count = (t: string) => sb.from(t).select("id", { count: "exact", head: true });
      const [m, msg, usage, ev] = await Promise.all([
        count("memories"), count("messages"),
        sb.from("usage").select("input_tokens, output_tokens"),
        sb.from("events").select("type, created_at").order("created_at", { ascending: false }).limit(8),
      ]);
      const bad = m.error || msg.error || usage.error || ev.error;
      if (bad) throw bad;
      const rows = usage.data ?? [];
      setS({ memories: m.count ?? 0, messages: msg.count ?? 0, calls: rows.length, tokens: rows.reduce((a, r) => a + r.input_tokens + r.output_tokens, 0), events: ev.data ?? [] });
    })().catch((e) => setErr(e.message ?? "Could not load analytics"));
  }, [sb]);
  if (err) return <p className="error">{err}</p>;
  if (!s) return <p className="muted">Loading…</p>;
  const stat = (n: number | string, l: string) => <div className="card"><div className="text-2xl">{n}</div><div className="muted text-xs">{l}</div></div>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">{stat(s.memories, "memories")}{stat(s.messages, "chat messages")}{stat(s.calls, "CORE calls")}{stat(s.tokens.toLocaleString(), "tokens used")}</div>
      <p className="muted text-xs">CORE runs on your Claude subscription, so there is no per-token cost to track.</p>
      <UsageMeter />
      <LifeStats />
      <h3 className="h3">Recent activity</h3>
      <ul className="space-y-1 text-sm">{s.events.map((e, i) => <li key={i}><b>{e.type}</b> <span className="muted">{when(e.created_at)}</span></li>)}{!s.events.length && <li className="muted">Nothing yet.</li>}</ul>
    </div>
  );
}
