"use client";
import { hereLink } from "./voice/object-command";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isSleepCommand } from "./voice/wake";
import { goToSleep } from "./voice/sleep";
import { createClient } from "@/lib/supabase/client";
import { numberCitations } from "@/lib/pure";
import { OPEN_SOURCE_EVENT } from "@/lib/week-pure";
import { takeLines } from "@/lib/streamjson";
import { followUps } from "@/lib/core-ui";
import { appendActivity } from "@/lib/core-activity-pure";
import { CoreActivity } from "./CoreActivity";
import { CoreWorkspace } from "./CoreWorkspace";
import { cancelsJob, missionOf, turnArtifact } from "@/lib/core-workspace-pure";
import { PasswordSection } from "./PasswordSection";
import { TimeCapsuleSection } from "./TimeCapsuleSection";
import { PhonePairing } from "./PhonePairing";
import { PlaceSection } from "./PlaceSection";
import { AutonomySection } from "./AutonomySection";
import { AuthoritySection } from "./AuthoritySection";
import { WeeklyReviewSetting } from "./RemoteCall";
import { PersonaSection } from "./PersonaSection";
import { ResultEvidence } from "./ResultEvidence";
import { DeliverableCards } from "./DeliverableCards";
import { wsConfirmOffer } from "@/lib/ws-intent-pure";
import { parseChoices, parseGoalCard, withoutCard } from "@/lib/goal-card-pure";
import { GoalCardView } from "./GoalCard";
import type { WriteEvidence } from "@/lib/completion-pure";
import type { Suggestion, InsightAction } from "@/lib/insights-pure";
import type { Plan } from "@/lib/plans-pure";
import { NAV_EVENT, parseNavCommand, type NavTarget } from "@/lib/nav-pure";
import { COMMAND_REPLY_EVENT, runNavCommand } from "./nav-command";
import { KINDS, type Kind } from "@/lib/kinds";
import { Markdown } from "./AgentsPanels";
import { useAttachments, AttachChips, ACCEPT } from "./CoreAttach";
import { VoiceMemo } from "./VoiceMemo";
import { ScreenLook, type LookAsk } from "./ScreenLook";
import { parseLookRequest, robloxErrors, LUAU_FIX_EVENT, type Preset } from "@/lib/screen-look-pure";
import { BeliefsPanel, takeBeliefsRequest } from "./BeliefsPanel";
import { EpisodesList } from "./EpisodesList";
import { Rewind } from "./Rewind";
import { LearnThis, StudyCards } from "./StudyCards";
import { LifeStats } from "./LifeStats";
import { UsageMeter } from "./UsageMeter";
import { AgentScorecard } from "./AgentScorecard";
import { OutcomesView, ReliabilityView, TimeCostView } from "./AnalyticsOutcomes";
import { PredictionScore } from "./OrbitThinks";
import { PerfRuns } from "./PerfRuns";
import { LessonChip, LessonsSection } from "./LessonsCard";
import { getLang, LangSwitch, useT } from "./i18n";
import { FailureReport } from "./FailureReport";
import { loadUsageTotals } from "@/lib/analytics-usage";
import { usageSummary, type UsageDays, type UsageTotal } from "@/lib/analytics-usage-pure";
import { eventLabel } from "@/lib/event-label-pure";
import { ChatSheet, chatsApi, useCoreChats } from "./CoreChats";
import { ACTIVE_CHAT_KEY, CORE_NEW_CHAT, codeBlocks } from "@/lib/core-chats-pure";
import { sentenceStream, speechChunks } from "./voice/speech-text";
import { CORE_BUSY } from "@/lib/interruption-pure";
import { CORE_SIGNAL, type CoreSignal } from "@/lib/core-mood-pure";
import { isLearned } from "@/lib/memory-world-pure";
import { OPEN_MEMORY_EVENT } from "@/lib/palette-pure";
import MemoryControls from "./MemoryControls";
import WorkspaceFrame, { useWorkspaceView } from "./WorkspaceFrame";
import { DupPreview, MemoryInspector, MemoryProjects, MemoryReview, MemorySearch, PeopleView } from "./MemoryWorkspace";
import { isProvTag, type DupChoice } from "@/lib/memory-capture-pure";
import { speakChunk, stop as stopSpeech, speechSettings, takeVoiceAsked, speechGen, onSpeakingChange } from "./voice/speak";

type Memory = { id: string; kind: Kind; title: string; content: string; url: string | null; storage_path: string | null; tags: string[]; created_at: string; updated_at: string; source: string; confirmation?: string | null; recheck_at?: string | null };
type Cite = { id: string; title: string; kind: string };
type Step = { step: string; detail: string; ms: number; ok: boolean; evidence?: WriteEvidence[]; answerEval?: { pass: boolean; flags: string[] } };
type Msg = { role: "user" | "assistant"; content: string; citations?: Cite[]; trace?: Step[]; error?: boolean; model?: "fast" | "smart" | "deep"; chips?: string[]; lesson?: { id: string; text: string }; fixes?: string[] };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

/* ---------------- CORE chat ---------------- */
export function CorePanel({ initial, onConsumed, onOpenMemory, greeting, onGreeted }: { initial: string | null; onConsumed: () => void; onOpenMemory: (id: string) => void; greeting?: string | null; onGreeted?: () => void }) {
  const { t: tr } = useT();
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
  const [heard, setHeard] = useState(""); // last spoken question, shown as the voice transcript
  const [copied, setCopied] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const att = useAttachments(); // files for the next message (📎 / drop / paste)
  const [lookAsk, setLookAsk] = useState<LookAsk | null>(null); // "look at my screen" said/typed: waits for his click (the browser needs one)
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

  const send = useCallback(async (text: string, fromVoice?: boolean, look?: Preset) => {
    const message = text.trim();
    const nav = parseNavCommand(message, { current: "core" });
    const asked = !look && !nav ? parseLookRequest(message) : null;
    if (asked) { setLookAsk(asked); setInput(""); return; } // never captures by itself: the strip shows a "choose the window" button
    if ((!message && !att.has()) || (busy && !nav)) return; // direct commands still work while CORE answers
    stopSpeech();
    if (isSleepCommand(message)) { void goToSleep(); return; }
    opening.current++; // sending wins over a chat still loading
    if (/^(start (a )?)?new (chat|conversation)[.!]?$/i.test(message) && !att.has()) { newChat(); return; }
    // Speak only answers to spoken questions; settings are re-read per chunk so toggling takes effect live.
    let myGen = speechGen(); // a later stop() (barge-in, Stop button) silences the rest of this answer
    const talk = fromVoice || takeVoiceAsked();
    if (talk) setHeard(message);
    const say = (parts: string[]) => { if (talk && speechSettings().speak) parts.forEach((p) => speakChunk(p, myGen)); };
    const voiceOut = sentenceStream(true);
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
        body: JSON.stringify({ message, conversationId: convo.current, projectId: convo.current ? undefined : newProject ?? undefined, voice: talk, lang: getLang(), here: hereLink(), screen: look ? true : undefined, attachments: files.length ? files.map((f) => ({ name: f.name, data: f.data })) : undefined }),
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
        const ev = JSON.parse(line) as { type: string; conversationId?: string; text?: string; answer?: string; citations?: Cite[]; trace?: Step[]; error?: string; to?: NavTarget; label?: string; tool?: string; model?: "fast" | "smart" | "deep"; lesson?: { id: string; text: string } };
        if (ev.conversationId && ev.conversationId !== convo.current) { setChatId(ev.conversationId); void chats.reload(); }
        if (ev.type === "delta" && ev.text) {
          partial += ev.text;
          say(voiceOut.push(ev.text));
          // One render per frame at most, and only the streaming bubble changes.
          if (!raf) raf = requestAnimationFrame(() => { raf = 0; setLive(partial); });
        } else if (ev.type === "step" && ev.label) {
          setActivity((labels) => appendActivity(labels, ev.label!));
          if (ev.tool) dispatchEvent(new CustomEvent<CoreSignal>(CORE_SIGNAL, { detail: { type: "step", tool: ev.tool } })); // the singularity shows it (E4)
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
          say(partial.trim() ? voiceOut.flush() : speechChunks(ev.answer ?? "", true));
          setLive(null);
          setMsgs((m) => [...m, { role: "assistant", content: ev.answer ?? "", citations: ev.citations, trace: ev.trace, model: ev.model,
            chips: [...parseChoices(ev.answer ?? ""), ...followUps(message, (ev.trace ?? []).map((s) => s.step))], lesson: ev.lesson, fixes: look === "roblox" ? robloxErrors(ev.answer ?? "") : undefined }]);
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
      if (!stopped) dispatchEvent(new CustomEvent<CoreSignal>(CORE_SIGNAL, { detail: { type: "error" } }));
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

  // While CORE is open: Esc stops a streaming answer instead of closing the panel. (Ctrl/⌘+K is the Warp palette.)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return; // VoiceControls already used this Esc (both listen in the capture phase)
      if (e.key === "Escape" && busy) { e.preventDefault(); e.stopPropagation(); abort.current?.abort(); stopSpeech(); }
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
    // Busy: never drop the new question (e.g. a voice follow-up).
    // A cancel stops the job; any other follow-up (talking over CORE included) waits for it to finish.
    if (busy) { if (cancelsJob(initial)) { abort.current?.abort(); stopSpeech(); } else queued.current = initial; }
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
        ? <Markdown text={numberCitations(withoutCard(m.content), (m.citations ?? []).map((c) => c.id))} openMemory={onOpenMemory} />
        : <div className="whitespace-pre-wrap">{m.content}</div>}
      {m.role === "assistant" && !m.error && (() => { const g = parseGoalCard(m.content); return g && <GoalCardView card={g} onChange={() => { setInput(""); inputRef.current?.focus(); }} />; })()}
      {!!m.citations?.length && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {m.citations.map((c, n) => <button key={c.id} className="chip" onClick={() => (c.kind.startsWith("week:") ? dispatchEvent(new CustomEvent(OPEN_SOURCE_EVENT, { detail: c })) : onOpenMemory(c.id))}>[{n + 1}] {c.title}</button>)}
        </div>
      )}
      {m.role === "assistant" && (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
          {!m.error && <>
            <button type="button" className="chip" aria-label={tr(copied === i ? "cf.copied" : "core.copyAnswer")} title={tr("common.copy")}
              onClick={() => { void navigator.clipboard?.writeText(m.content.replace(/\s*\[[ma]:[^\]]+\]/g, "")).then(() => { setCopied(i); setTimeout(() => setCopied((c) => (c === i ? -1 : c)), 1500); }); }}>
              {copied === i ? `✓ ${tr("cf.copied")}` : tr("common.copy")}
            </button>
            <button type="button" className="chip" aria-label={tr(speaking ? "core.stopSpeaking" : "core.readAloud")} title={tr(speaking ? "core.stopSpeaking" : "core.readAloud")}
              onClick={() => { const was = speaking; stopSpeech(); if (!was) speechChunks(m.content).forEach((c) => speakChunk(c)); }}>
              {speaking ? `■ ${tr("core.stop")}` : `🔊 ${tr("core.readAloud")}`}
            </button>
            <button type="button" className="chip" disabled={!project} title={tr(project ? "core.pinTitle" : "core.pinNeedsProject")}
              onClick={() => void pin(m.content)}>{pinned === m.content ? `✓ ${tr("core.pinned")}` : `📌 ${tr("core.pin")}`}</button>
            {project && codeBlocks(m.content) && (
              <button type="button" className="chip" title={tr("core.pinCodeTitle")} onClick={() => void pin(codeBlocks(m.content), `Code: ${chats.chats.find((c) => c.id === chatId)?.title ?? "chat"}`.slice(0, 100))}>
                {pinned === codeBlocks(m.content) ? `✓ ${tr("core.pinned")}` : `📌 ${tr("core.pinCode")}`}</button>
            )}
          </>}
          {i === msgs.length - 1 && lastQ.current && !busy && (
            <button type="button" className="chip" title={tr("core.retryTitle")} onClick={() => void send(lastQ.current)}>↻ {tr("task.retry")}</button>
          )}
          {m.trace?.some((x) => x.step === "local") && <span className="chip !py-0 !text-[10px]" title={tr("core.localTitle")}>{tr("core.local")}</span>}
          {m.model && <span className="muted ml-auto opacity-60" title={m.model === "fast" ? "Quick reply from the fast model" : m.model === "deep" ? (m.trace?.some((x) => x.step === "review") ? "Deep answer: planned, then self-checked by the strongest model" : "Deep answer from the strongest model") : "Answered by the main model"}>{m.model}</span>}
        </div>
      )}
      {!busy && i === msgs.length - 1 && !!m.chips?.length && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={tr("core.followUps")}>
          {m.chips.map((c) => <button key={c} type="button" className="chip" onClick={() => void send(c)}>{c}</button>)}
        </div>
      )}
      {!busy && i === msgs.length - 1 && (() => { const ws = m.trace?.map((x) => wsConfirmOffer(x.detail.split(" → ").slice(1).join(" → "))).filter(Boolean).at(-1); return ws && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label={tr("ws.confirm", { ws })}>
          <span>{tr("ws.confirm", { ws })}</span>
          <button type="button" className="chip" onClick={() => void send(tr("ws.buildIt"))}>{tr("ws.buildIt")}</button>
          <button type="button" className="chip" onClick={() => void send(tr("ws.notNow"))}>{tr("ws.notNow")}</button>
        </div>); })()}
      {!!m.fixes?.length && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={tr("core.robloxErrors")}>
          {m.fixes.map((f) => <button key={f} type="button" className="chip max-w-full truncate" title={`Open the Luau helper (docs-checked) in Fix mode with: ${f}`}
            onClick={() => { dispatchEvent(new CustomEvent(LUAU_FIX_EVENT, { detail: f })); dispatchEvent(new CustomEvent(NAV_EVENT, { detail: { panel: "creation" } })); }}>🩹 {tr("core.fixDocs")} {f.slice(0, 60)}</button>)}
        </div>
      )}
      {m.lesson && <LessonChip lesson={m.lesson} />}
      {!!m.trace?.length && (
        <><DeliverableCards items={m.trace.flatMap((s) => s.evidence ?? [])} /><ResultEvidence items={m.trace.flatMap((s) => s.evidence ?? [])} openMemory={onOpenMemory} /></>
      )}
      {!!m.trace?.length && (
        <details className="mt-2 text-xs muted">
          <summary className="cursor-pointer">{tr("core.trace")}</summary>
          <ul className="mt-1 space-y-0.5">{m.trace.map((s, n) => <li key={n}>{s.ok ? "✓" : "✗"} <b>{s.step}</b> · {s.ms}ms · {s.detail}</li>)}</ul>
        </details>
      )}
      {m.role === "assistant" && (m.error || m.trace?.some((s) => !s.ok || s.answerEval?.pass === false)) && (
        <div className="mt-2"><FailureReport input={{ kind: "turn", id: chatId, relatedIds: chatId ? [chatId] : [], model: m.model ?? null, error: m.error ? m.content : null,
          trace: m.trace ?? [], request: msgs[i - 1]?.role === "user" ? msgs[i - 1].content : "", answer: m.error ? "" : m.content }} /></div>
      )}
    </div>
  )), [msgs, onOpenMemory, speaking, copied, busy, send, project, pinned, tr, chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastCore = [...msgs].reverse().find((m) => m.role === "assistant" && !m.error);
  const artifact = useMemo(() => (lastCore ? turnArtifact(lastCore.content) : null), [lastCore]);
  const mission = busy ? missionOf([], activity, true) : missionOf(lastCore?.trace, [], false, !!artifact) // while busy, the old turn's steps aren't this job's;
  return (
    <div className="core-ws">
    <div className="relative flex h-full min-w-0 flex-col" onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); void att.add(e.dataTransfer.files); } }}>
      <div className="mb-2 flex items-center gap-1.5 text-xs">
        <button type="button" className="chip" aria-expanded={sheet} onClick={() => setSheet((v) => !v)} title={tr("core.chatsTitle")}>☰ {tr("core.chats")}</button>
        <span className="min-w-0 flex-1 truncate font-semibold">{chatId ? chats.chats.find((c) => c.id === chatId)?.title ?? tr("core.chat") : tr("core.newChat")}</span>
        <span className="muted shrink-0" aria-live="polite">{busy ? tr("auto.saving") : chatId ? `✓ ${tr("life.saved")}` : ""}</span>
        {!!chats.projects.length && (
          <select className="field max-w-[8rem] py-1 text-xs" aria-label={tr("core.projectFor")} value={project ?? ""}
            onChange={(e) => { const v = e.target.value || null; setNewProject(v); if (chatId) void chats.act({ action: "move", id: chatId, projectId: v }); }}>
            <option value="">{tr("ops.noProject")}</option>
            {chats.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <button type="button" className="chip" onClick={() => newChat()} disabled={!msgs.length && !chatId} title={tr("core.newTitle")}>＋ {tr("core.new")}</button>
      </div>
      {chats.error && !sheet && <p className="error mb-2 text-xs" role="alert">{chats.error}</p>}
      {sheet && <ChatSheet {...chats} activeId={chatId} onOpen={(id) => void openChat(id)} onNew={newChat} onClose={() => setSheet(false)}
        onDeleted={(id) => { if (id === chatId) newChat(); }} />}
      <CoreSuggests tick={msgs.length} />
      <PlanCard tick={msgs.length} />
      <div className="flex-1 space-y-4 overflow-y-auto pr-1" aria-live="polite" aria-busy={busy}>
        {!msgs.length && <p className="muted">{tr("core.intro")}</p>}
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
      <ScreenLook busy={busy} input={input} ask={lookAsk} onAsk={setLookAsk} run={async (file, text, preset) => { await att.add([file]); await send(text, false, preset); }} />
      <VoiceMemo compact />
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <input ref={fileRef} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden aria-label={tr("core.attach")} onChange={(e) => { if (e.target.files) void att.add(e.target.files); e.target.value = ""; }} />
        <button type="button" className="btn" title={tr("core.attachTitle")} aria-label={tr("core.attach")} disabled={busy} onClick={() => fileRef.current?.click()}>📎</button>
        <input ref={inputRef} className="field flex-1" value={input} onChange={(e) => setInput(e.target.value)} onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); void att.add(e.clipboardData.files); } }} placeholder={tr("core.ph")}
          onKeyDown={(e) => { if (e.key === "ArrowUp" && !input && lastQ.current) { e.preventDefault(); setInput(lastQ.current); } }} maxLength={8000} aria-label={tr("core.message")} />
        {busy
          ? <button type="button" className="btn" onClick={() => { abort.current?.abort(); stopSpeech(); }}>{tr("core.stop")}</button>
          : speaking && !input.trim()
            ? <button type="button" className="btn" onClick={stopSpeech}>{tr("core.stop")}</button>
            : <button className="btn" disabled={!input.trim() && !att.items.length}>{tr("core.send")}</button>}
      </form>
    </div>
    <CoreWorkspace artifact={artifact} mission={mission} busy={busy} heard={heard} onAsk={(t) => void send(t)} />
    </div>
  );
}

/** "CORE suggests": up to 3 proactive suggestions (src/lib/insights-pure.ts), each with its one-click action and dismiss. */
function CoreSuggests({ tick }: { tick: number }) {
  const { t: tr } = useT();
  const [items, setItems] = useState<Suggestion[]>([]);
  const [busyKey, setBusyKey] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(() => { api<{ items: Suggestion[] }>("/api/insights").then((r) => setItems(r.items), () => {}); }, []);
  useEffect(() => { load(); const t = setInterval(() => { if (!document.hidden) load(); }, 60_000); return () => clearInterval(t); }, [load, tick]);
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
    <section className="mb-3 space-y-1.5" aria-label={tr("core.suggests")}>
      <div className="muted text-xs uppercase tracking-wide">{tr("core.suggests")}</div>
      {items.slice(0, 3).map((s) => (
        <div key={s.key} className="glass flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm">
          <span className="min-w-0 flex-1" title={s.detail}>{s.priority === "high" && <span aria-label={tr("core.important")}>● </span>}{s.title}</span>
          {s.actions.map((a) => <button key={a.label} type="button" className="chip" disabled={!!busyKey} onClick={() => void run(s, a)}>{busyKey === s.key ? "…" : a.label}</button>)}
          <button type="button" className="chip" aria-label={tr("cf.dismissAria", { title: s.title })} title={tr("cf.dismiss")} disabled={!!busyKey} onClick={() => void mark(s.key, "dismiss")}>✕</button>
        </div>
      ))}
      {err && <p className="text-xs text-red-400" role="alert">{err}</p>}
    </section>
  );
}

/** A CORE plan's progress ("Step 2/4: rendering… 62%"), the OK button for scheduling steps, and Cancel. */
function PlanCard({ tick }: { tick: number }) {
  const { t: tr } = useT();
  const [plan, setPlan] = useState<(Plan & { line: string }) | null>(null);
  const [err, setErr] = useState("");
  const active = plan?.status === "running" || plan?.status === "waiting";
  const load = useCallback(() => { api<{ plan: (Plan & { line: string }) | null }>("/api/plans").then((r) => setPlan(r.plan), () => {}); }, []);
  useEffect(() => { load(); const t = setInterval(() => { if (!document.hidden) load(); }, active ? 4000 : 30_000); return () => clearInterval(t); }, [load, active, tick]);
  const act = (op: "confirm" | "cancel") => {
    if (!plan) return;
    setErr("");
    api<{ plan: Plan & { line: string } }>("/api/plans", { method: "POST", body: JSON.stringify({ id: plan.id, op, step: plan.current }) })
      .then((r) => setPlan(r.plan), (e) => setErr(e instanceof Error ? e.message : "failed"));
  };
  if (!plan || (!active && Date.now() - Date.parse(plan.updatedAt) > 10 * 60_000)) return null;
  return (
    <section className="glass mb-3 rounded-lg px-3 py-2 text-sm" aria-label={tr("core.plan")} aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <b className="min-w-0 flex-1">{plan.goal}</b>
        {plan.status === "waiting" && <button type="button" className="btn" onClick={() => act("confirm")}>{tr("core.okSchedule")}</button>}
        {active && <button type="button" className="chip" onClick={() => act("cancel")}>{tr("common.cancel")}</button>}
      </div>
      <div className={plan.status === "failed" ? "mt-1 text-red-400" : "muted mt-1"}>{plan.line}</div>
      {err && <p className="text-xs text-red-400" role="alert">{err}</p>}
    </section>
  );
}

/* ---------------- MEMORY ---------------- */
type LinkRow = { id: string; status: string; score: number | null; from: { id: string; title: string } | null; to: { id: string; title: string } | null };

export function MemoryPanel({ focusId, onChanged }: { focusId: string | null; onChanged: () => void }) {
  const { t: tr } = useT();
  const [items, setItems] = useState<Memory[]>([]);
  const [hits, setHits] = useState<Memory[]>([]);
  const [q, setQ] = useState(""); // the last search run; "" = none
  const [mode, setMode] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<Memory | null>(null);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [form, setForm] = useState({ kind: "note" as Kind, title: "", content: "", url: "", tags: "" });
  const [saving, setSaving] = useState(false);
  const [dup, setDup] = useState<{ duplicate: React.ComponentProps<typeof DupPreview>["dup"]; preview: React.ComponentProps<typeof DupPreview>["preview"]; again: (c: DupChoice) => void } | null>(null);
  const [learnedOnly, setLearnedOnly] = useState(false);
  const [episodesOnly, setEpisodesOnly] = useState(false);
  const [beliefs, setBeliefs] = useState(false);
  const views = (["search", "recent", "projects", "people", "review"] as const).map((id) => ({ id, label: tr(`memws.${id}`) }));
  const [view, setView] = useWorkspaceView("memory", views);
  useEffect(() => {
    if (takeBeliefsRequest()) setBeliefs(true); // "what do you know about me" opened MEMORY
    const h = (e: Event) => { if ((e as CustomEvent<NavTarget>).detail?.beliefs) { takeBeliefsRequest(); setBeliefs(true); } };
    addEventListener(NAV_EVENT, h);
    return () => removeEventListener(NAV_EVENT, h);
  }, []);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File, choice?: DupChoice) {
    setSaving(true); setErr(""); setNote(""); setDup(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      if (form.title.trim()) fd.set("title", form.title.trim());
      if (form.content.trim()) fd.set("note", form.content.trim());
      if (form.tags.trim()) fd.set("tags", form.tags);
      if (choice) fd.set("onDuplicate", choice);
      const res = await fetch("/api/memories/upload", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409 && json.preview) return setDup({ ...json, again: (c: DupChoice) => void upload(file, c) });
      if (!res.ok) throw new Error(json.error || `Upload failed (${res.status})`);
      setNote(`Saved ${file.name}${json.extractedChars ? ` (${json.extractedChars.toLocaleString()} characters of text read)` : ""}.`);
      setForm({ ...form, title: "", content: "", url: "", tags: "" });
      await Promise.all([reload(), loadLinks()]); onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
    finally { setSaving(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  const load = useCallback(async (query: string) => {
    try {
      const r = await api<{ results: Memory[]; mode: string }>(`/api/memories${query ? `?q=${encodeURIComponent(query)}` : ""}`);
      if (query) { setHits(r.results); setMode(r.mode); setQ(query); } else setItems(r.results);
      setErr("");
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load"); }
  }, []);
  const loadLinks = useCallback(async () => {
    try { setLinks((await api<{ links: LinkRow[] }>("/api/links")).links); } catch { /* shown via main error on next load */ }
  }, []);

  useEffect(() => { void load(""); void loadLinks(); }, [load, loadLinks]);
  const reload = () => Promise.all([load(""), q && load(q)]).then(() => {});
  useEffect(() => {
    if (!focusId) return;
    api<{ memory: Memory }>(`/api/memories/${focusId}`).then((r) => setOpen(r.memory)).catch((e) => setErr(e.message));
  }, [focusId]);

  async function capture(e?: React.FormEvent, choice?: DupChoice) {
    e?.preventDefault();
    setSaving(true); setErr(""); setNote(""); setDup(null);
    try {
      const res = await fetch("/api/memories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, onDuplicate: choice }) });
      const r = await res.json().catch(() => ({}));
      if (res.status === 409 && r.preview) return setDup({ ...r, again: (c: DupChoice) => void capture(undefined, c) });
      if (!res.ok) throw new Error(r.error || `Could not save (${res.status})`);
      setNote(`Saved.${r.suggested ? ` ${r.suggested} related memories suggested below.` : ""}${r.embedded ? "" : " (keyword search only; no embeddings configured)"}`);
      setForm({ ...form, title: "", content: "", url: "", tags: "" });
      await Promise.all([reload(), loadLinks()]); onChanged();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not save"); }
    finally { setSaving(false); }
  }

  async function saveEdit() {
    if (!open) return;
    try {
      await api(`/api/memories/${open.id}`, { method: "PATCH", body: JSON.stringify({ title: open.title, content: open.content, tags: open.tags }) });
      setOpen(null); await reload(); onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not update"); }
  }
  async function remove() {
    if (!open || !confirm(tr("mem.deleteConfirm", { title: open.title }))) return;
    try { await api(`/api/memories/${open.id}`, { method: "DELETE" }); setOpen(null); await Promise.all([reload(), loadLinks()]); onChanged(); }
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
        <button className="link" onClick={() => setOpen(null)}>{tr("mem.back")}</button>
        <input className="field w-full" value={open.title} onChange={(e) => setOpen({ ...open, title: e.target.value })} aria-label={tr("cf.titleLbl")} />
        <textarea className="field h-56 w-full" value={open.content} onChange={(e) => setOpen({ ...open, content: e.target.value })} aria-label={tr("mem.content")} />
        <input className="field w-full" value={open.tags.join(", ")} onChange={(e) => setOpen({ ...open, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} placeholder={tr("mem.tagsPh")} aria-label={tr("mem.tags")} />
        <MemoryInspector m={open} />
        <p className="muted text-xs">{open.kind} · {tr("mem.source", { s: open.source })}{open.url && <> · <a className="link" href={open.url} target="_blank" rel="noreferrer noopener">{tr("mem.openLink")}</a></>}{open.storage_path && <> · <a className="link" href={`/api/memories/${open.id}/file`} target="_blank" rel="noreferrer">{tr("mem.openFile")}</a></>} · {tr("mem.dates", { c: when(open.created_at), u: when(open.updated_at) })}</p>
        <MemoryControls key={open.id} id={open.id} content={open.content} confirmation={open.confirmation} recheckAt={open.recheck_at} onOpen={setFocus}
          onDone={(gone) => { if (gone) setOpen(null); void reload(); onChanged(); }} />
        {err && <p className="error">{err}</p>}
        <div className="flex gap-2"><button className="btn" onClick={saveEdit}>{tr("habit.save")}</button><button className="btn danger" onClick={remove}>{tr("rules.delete")}</button></div>
        <LearnThis key={open.id} memory={open} />
      </div>
    );
  }

  const row = (m: Memory, why?: React.ReactNode) => (
    <button className="card w-full text-left" onClick={() => pick(m)}>
      <div className="font-medium">{m.title}{isLearned(m.source) && <span className="badge learned ml-2 align-middle">{tr("mem.learned").toUpperCase()}</span>}</div>
      <div className="muted line-clamp-2 text-xs">{m.content.slice(0, 200)}</div>
      <div className="muted mt-1 text-[11px]">{m.kind} · {when(m.created_at)}{m.tags.some((t) => !isProvTag(t)) ? ` · ${m.tags.filter((t) => !isProvTag(t)).map((t) => `#${t}`).join(" ")}` : ""}</div>
      {why}
    </button>
  );
  const chips = <>
    <button type="button" className="chip" aria-pressed={learnedOnly} onClick={() => setLearnedOnly(!learnedOnly)}>{tr("mem.learned")}</button>
    <button type="button" className="chip" aria-pressed={episodesOnly} onClick={() => setEpisodesOnly(!episodesOnly)}>{tr("mem.episodes")}</button>
  </>;
  const learned = (xs: Memory[]) => (learnedOnly ? xs.filter((m) => isLearned(m.source)) : xs);

  return (
    <WorkspaceFrame planet="memory" title={tr("mem.title")} views={views} view={view} onView={setView}
      context={tr("memws.context", { n: items.length, r: suggested.length })}
      action={<span className="flex gap-3"><button type="button" className="link text-xs" onClick={() => setBeliefs(true)}>{tr("mem.beliefs")}</button><a className="link text-xs" href="/api/export">{tr("mem.export")}</a></span>}>
      {err && view !== "recent" && <p className="error" role="alert">{err}</p>}
      {view === "search" && (episodesOnly ? <><div className="flex gap-2">{chips}</div><EpisodesList onOpen={setFocus} /></>
        : <MemorySearch recent={learned(items)} hits={learned(hits)} searched={q} mode={mode} onSearch={(x) => (x ? void load(x) : setQ(""))} row={row}>{chips}</MemorySearch>)}
      {view === "recent" && <>
        <form onSubmit={capture} className="space-y-2">
          <h3 className="h3">{tr("mem.capture")}</h3>
          <textarea className="field h-24 w-full" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder={tr("mem.capturePh")} aria-label={tr("mem.content")} maxLength={200000} />
          <div className="flex gap-2">
            <input className="field flex-1" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={tr("mem.titlePh")} aria-label={tr("cf.titleLbl")} maxLength={300} />
            <select className="field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })} aria-label={tr("mem.kind")}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
          </div>
          <div className="flex gap-2">
            <input className="field flex-1" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder={tr("mem.urlPh")} aria-label={tr("mem.url")} />
            <input className="field flex-1" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder={tr("mem.tagsShort")} aria-label={tr("mem.tags")} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn" disabled={saving || (!form.content.trim() && !form.url.trim() && !form.title.trim())}>{tr(saving ? "auto.saving" : "mem.save")}</button>
            <label className={`chip cursor-pointer${saving ? " opacity-50" : ""}`}>
              {tr("mem.upload")}
              <input ref={fileRef} type="file" className="sr-only" disabled={saving}
                accept=".pdf,.docx,.txt,.md,.csv,image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
            </label>
            <span className="muted text-xs">{tr("mem.uploadHint")}</span>
          </div>
          {dup && <DupPreview dup={dup.duplicate} preview={dup.preview} onChoose={dup.again} onCancel={() => setDup(null)} />}
          {note && <p className="ok">{note}</p>}
          {err && <p className="error">{err}</p>}
        </form>
        <Rewind onOpen={setFocus} />
        <div className="flex flex-wrap gap-2">{chips}</div>
        {episodesOnly ? <EpisodesList onOpen={setFocus} /> : <ul className="space-y-2">
          {shown.map((m) => <li key={m.id}>{row(m)}</li>)}
          {!shown.length && !err && <li className="muted">{tr(learnedOnly ? "mem.noLearned" : "mem.empty")}</li>}
        </ul>}
      </>}
      {view === "projects" && <MemoryProjects items={items} row={row} />}
      {view === "people" && <PeopleView />}
      {view === "review" && <>
        <StudyCards />
        <MemoryReview onChanged={onChanged} />
        {!!suggested.length && (
          <div>
            <h3 className="h3">{tr("mem.suggested")}</h3>
            <p className="muted text-xs">{tr("mem.suggestedHint")}</p>
            <ul className="mt-2 space-y-2">
              {suggested.map((l) => (
                <li key={l.id} className="card text-sm">
                  <button className="link text-left" onClick={() => l.from && setFocus(l.from.id)}>{l.from?.title}</button> ↔ <button className="link text-left" onClick={() => l.to && setFocus(l.to.id)}>{l.to?.title}</button>
                  <span className="muted"> · {Math.round((l.score ?? 0) * 100)}%</span>
                  <div className="mt-1 flex gap-2"><button className="chip" onClick={() => decide(l.id, "confirmed")}>{tr("rules.confirm")}</button><button className="chip" onClick={() => decide(l.id, "rejected")}>{tr("cf.dismiss")}</button></div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button type="button" className="chip" onClick={() => setBeliefs(true)}>{tr("mem.beliefs")}</button>
      </>}
    </WorkspaceFrame>
  );

  // Opening from a list also selects its star in the constellation (Orbit turns the event into focusId).
  function pick(m: Memory) { setOpen(m); dispatchEvent(new CustomEvent(OPEN_MEMORY_EVENT, { detail: { id: m.id } })); }

  function setFocus(id: string) {
    api<{ memory: Memory }>(`/api/memories/${id}`).then((r) => setOpen(r.memory)).catch((e) => setErr(e.message));
  }
}

/* ---------------- PROFILE ---------------- */
const LIST_FIELDS = [["interests", "profile.interests"], ["projects", "profile.projects"], ["goals", "profile.goals"], ["news_topics", "profile.news_topics"], ["research_priorities", "profile.research_priorities"]] as const;

export function ProfilePanel() {
  const { t } = useT();
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
    try { await api("/api/profile", { method: "PUT", body: JSON.stringify(p) }); setMsg(t("profile.saved")); } catch (e2) { setMsg(e2 instanceof Error ? e2.message : "Could not save"); }
  }
  return (
    <div className="space-y-6">
    <section className="space-y-1">
      <LangSwitch />
      <p className="muted text-xs">{t("lang.hint")}</p>
    </section>
    <form onSubmit={save} className="space-y-3">
      <p className="muted text-sm">{t("profile.intro")}</p>
      <label className="block text-sm">{t("profile.name")}<input className="field mt-1 w-full" value={p.display_name ?? ""} onChange={(e) => setP({ ...p, display_name: e.target.value })} /></label>
      {LIST_FIELDS.map(([k, label]) => (
        <label key={k} className="block text-sm">{t(label)} <span className="muted">{t("profile.comma")}</span>
          <input className="field mt-1 w-full" value={p[k] ?? ""} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></label>
      ))}
      <label className="block text-sm">{t("profile.talk")}<textarea className="field mt-1 h-20 w-full" value={p.communication ?? ""} onChange={(e) => setP({ ...p, communication: e.target.value })} maxLength={1000} /></label>
      <button className="btn">{t("profile.save")}</button> {msg && <span className="muted text-sm">{msg}</span>}
    </form>
    <PasswordSection />
    <AutonomySection />
    <AuthoritySection />
    <PhonePairing />
    <WeeklyReviewSetting />
    <TimeCapsuleSection />
    <PlaceSection />
    <PersonaSection />
    <PlaybookSection />
    <LessonsSection />
    </div>
  );
}

type PlaybookData = { available: boolean; message?: string; rules: string[]; version: number; history: { version: number; rules: string[]; source: string; at: string }[] };
const sourceLabel = (s: string) => (s.startsWith("user") ? "you" + (s === "user:clear" ? " (cleared)" : "") : s.startsWith("revert") ? `revert to ${s.slice(7)}` : "CORE");

function PlaybookSection() {
  const { t, tn } = useT();
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
      <h3 id="playbook-h" className="h3">{t("profile.playbook")}</h3>
      <p className="muted text-xs">{t("pb.intro")}</p>
      {d && !d.available ? <p className="muted text-sm">{d.message}</p> : !d ? (!msg && <p className="muted text-sm">{t("common.loading")}</p>) : (
        <>
          <ul className="space-y-2">
            {draft.map((r, i) => (
              <li key={i} className="flex gap-2">
                <input className="field flex-1 text-sm" value={r} maxLength={200} aria-label={t("pb.rule", { n: i + 1 })} disabled={busy}
                  onChange={(e) => setDraft(draft.map((x, j) => (j === i ? e.target.value : x)))}
                  onKeyDown={(e) => { if (e.key === "Enter" && dirty) void post({ action: "set", rules: draft }); }} />
                <button type="button" className="chip" disabled={busy} aria-label={t("pb.deleteRule", { n: i + 1 })} onClick={() => post({ action: "set", rules: draft.filter((_, j) => j !== i) }, t("pb.removed"))}>{t("rules.delete")}</button>
              </li>
            ))}
            {!draft.length && <li className="muted text-sm">{t("pb.empty")}</li>}
          </ul>
          {dirty && <div className="flex gap-2"><button type="button" className="btn" disabled={busy} onClick={() => post({ action: "set", rules: draft })}>{t("auto.saveChanges")}</button><button type="button" className="chip" onClick={() => setDraft(d.rules)}>{t("pb.undo")}</button></div>}
          <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (add.trim() && await post({ action: "set", rules: [...draft, add] }, t("pb.added"))) setAdd(""); }}>
            <input className="field flex-1 text-sm" value={add} onChange={(e) => setAdd(e.target.value)} placeholder={t("pb.addPh")} maxLength={200} aria-label={t("pb.newRule")} disabled={busy || draft.length >= 30} />
            <button className="btn" disabled={busy || !add.trim() || draft.length >= 30}>{t("common.add")}</button>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            {!!d.rules.length && <button type="button" className="chip" disabled={busy} onClick={() => confirm(t("pb.clearConfirm")) && post({ action: "clear" }, t("pb.cleared"))}>{t("pb.clearAll")}</button>}
            {d.version > 0 && <span className="muted text-xs">{t("pb.version", { n: d.version })}</span>}
          </div>
          {d.history.length > 1 && (
            <details className="learn-history">
              <summary className="link text-xs">{t("pb.previous")}</summary>
              <ul className="mt-2 space-y-1">
                {d.history.filter((h) => h.version !== d.version).map((h) => (
                  <li key={h.version} className="flex items-center justify-between gap-2 text-xs">
                    <span className="muted" title={h.rules.join("\n") || "(no rules)"}>v{h.version} · {sourceLabel(h.source)} · {tn("pb.rules", h.rules.length)} · {when(h.at)}</span>
                    <button type="button" className="chip" disabled={busy} onClick={() => post({ action: "revert", version: h.version }, t("pb.reverted", { n: h.version }))}>{t("pb.revert")}</button>
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
  const { t: tr } = useT();
  const sb = useMemo(() => createClient(), []);
  const [days, setDays] = useState<UsageDays>(7);
  const views = [{ id: "outcomes", label: tr("ana.views.outcomes") }, { id: "reliability", label: tr("ana.views.reliability") }, { id: "cost", label: tr("ana.views.cost") }, { id: "perf", label: tr("ana.views.perf") }] as const;
  const [view, setView] = useWorkspaceView("analytics", views);
  const [s, setS] = useState<{ memories: number; messages: number; calls: number; tokens: number; usage: UsageTotal[]; events: { type: string; created_at: string }[] } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let active = true;
    setErr(""); setS(null);
    (async () => {
      const count = (t: string) => sb.from(t).select("id", { count: "exact", head: true });
      const [m, msg, usage, ev] = await Promise.all([
        count("memories"), count("messages"),
        loadUsageTotals(sb, days),
        sb.from("events").select("type, created_at").order("created_at", { ascending: false }).limit(8),
      ]);
      const bad = m.error || msg.error || ev.error;
      if (bad) throw bad;
      if (active) setS({ memories: m.count ?? 0, messages: msg.count ?? 0, ...usageSummary(usage), usage, events: ev.data ?? [] });
    })().catch((e) => { if (active) setErr(e.message ?? "Could not load analytics"); });
    return () => { active = false; };
  }, [sb, days]);
  const stat = (n: number | string, l: string) => <div className="card"><div className="text-2xl">{n}</div><div className="muted text-xs">{l}</div></div>;
  const period = <div className="flex gap-2" role="group" aria-label={tr("an.period")}>{([7, 30] as const).map((d) => <button key={d} className="chip" aria-pressed={days === d} onClick={() => setDays(d)}>{tr("an.lastDays", { n: d })}</button>)}</div>;
  return (
    <WorkspaceFrame planet="analytics" title={tr("planet.analytics")} context={tr("ana.context")} action={period} views={views} view={view} onView={setView}>
      {view === "outcomes" ? <OutcomesView days={days} /> : view === "reliability" ? <ReliabilityView days={days} /> : view === "cost" ? <TimeCostView days={days} /> :
      err ? <p className="error" role="alert">{err}</p> : !s ? <p className="muted" role="status">{tr("common.loading")}</p> : <>
      <div className="grid grid-cols-2 gap-2">{stat(s.memories, tr("an.memories"))}{stat(s.messages, tr("an.messages"))}{stat(s.calls, tr("an.calls", { n: days }))}{stat(s.tokens.toLocaleString(), tr("an.tokens", { n: days }))}</div>
      <table className="w-full text-xs" aria-label={tr("an.tableAria", { n: days })}>
        <thead><tr><th className="text-left">{tr("an.model")}</th><th className="text-right">{tr("an.callsCol")}</th><th className="text-right">{tr("an.tokensCol")}</th></tr></thead>
        <tbody>{s.usage.map((g) => <tr key={JSON.stringify([g.model, g.purpose])}><td>{g.model} / {g.purpose}</td><td className="text-right num">{Number(g.calls).toLocaleString()}</td><td className="text-right num">{usageSummary([g]).tokens.toLocaleString()}</td></tr>)}{!s.usage.length && <tr><td colSpan={3} className="muted">{tr("an.noUsage")}</td></tr>}</tbody>
      </table>
      <p className="muted text-xs">{tr("an.subscription")}</p>
      <UsageMeter />
      <AgentScorecard />
      <PredictionScore />
      <PerfRuns />
      <LifeStats />
      <h3 className="h3">{tr("an.recent")}</h3>
      <ul className="space-y-1 text-sm">{s.events.map((e, i) => { const event = eventLabel(e.type); return <li key={i}><span aria-hidden="true">{event.icon}</span> <b>{event.label}</b> <span className="muted">{when(e.created_at)}</span></li>; })}{!s.events.length && <li className="muted">{tr("an.nothing")}</li>}</ul>
      </>}
    </WorkspaceFrame>
  );
}
