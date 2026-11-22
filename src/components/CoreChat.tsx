"use client";
// CORE chat (moved out of panels.tsx so the phone /chat app loads only the chat, not the galaxy and every planet).
import { hereLink } from "./voice/object-command";
import type { DeepLink } from "@/lib/deeplink-pure";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isSleepCommand } from "./voice/wake";
import { goToSleep } from "./voice/sleep";
import { numberCitations } from "@/lib/pure";
import { OPEN_SOURCE_EVENT } from "@/lib/week-pure";
import { takeLines } from "@/lib/streamjson";
import { dropNote, handoffTask } from "@/lib/long-work-pure";
import { applyLive, type LiveEvent, type LiveRow } from "@/lib/core-live-pure";
import { turnRunState } from "@/lib/skill-run-pure";
import { CORE_OPEN_SKILL_CHAT, updateSkillRun, type SkillLaunch } from "./skill-run-receipts";
import { CoreActivity } from "./CoreActivity";
import { CoreWorkspace } from "./CoreWorkspace";
import { cancelsJob, missionOf, turnArtifact } from "@/lib/core-workspace-pure";
import { ResultEvidence } from "./ResultEvidence";
import { DeliverableCards, ReceiptChip } from "./DeliverableCards";
import { wsConfirmOffer } from "@/lib/ws-intent-pure";
import { parseChoices, parseGoalCard, withoutCard } from "@/lib/goal-card-pure";
import { followUps } from "@/lib/core-ui";
import { GoalCardView } from "./GoalCard";
import type { WriteEvidence } from "@/lib/completion-pure";
import type { Suggestion, InsightAction } from "@/lib/insights-pure";
import type { Plan } from "@/lib/plans-pure";
import { NAV_EVENT, parseNavCommand, type NavTarget } from "@/lib/nav-pure";
import { COMMAND_REPLY_EVENT, runNavCommand } from "./nav-command";
import { ChatAnswer } from "./ChatAnswer";
import { ProgressCard } from "./ProgressCard";
import { LONG_TURN_MS, composerKey, nearBottom, turnProgress } from "@/lib/core-chat-pure";
import { useAttachments, AttachChips, ACCEPT } from "./CoreAttach";
import { VoiceMemo } from "./VoiceMemo";
import { ScreenLook, type LookAsk } from "./ScreenLook";
import { parseLookRequest, robloxErrors, LUAU_FIX_EVENT, type Preset } from "@/lib/screen-look-pure";
import { LessonChip } from "./LessonsCard";
import { getLang, useT } from "./i18n";
import { usedLine } from "@/lib/core-used-pure";
import { FailureReport } from "./FailureReport";
import { AllowOnceCard } from "./AllowOnceCard";
import { turnFailed } from "@/lib/failure-report-pure";
import { ChatSheet, chatsApi, useCoreChats } from "./CoreChats";
import { ACTIVE_CHAT_KEY, CORE_NEW_CHAT, CORE_PROJECT_REQUEST_KEY, projectChatRequest, codeBlocks } from "@/lib/core-chats-pure";
import { sentenceStream, speechChunks } from "./voice/speech-text";
import { CORE_BUSY } from "@/lib/interruption-pure";
import { CORE_SIGNAL, type CoreSignal } from "@/lib/core-mood-pure";
import { corePhase } from "./motion/motion";
import { createPacer, useStreamFade } from "./motion/stream";
import { CorePresence } from "./motion/CorePresence";
import { speakChunk, stop as stopSpeech, speechSettings, takeVoiceAsked, speechGen, onSpeakingChange } from "./voice/speak";


type Cite = { id: string; title: string; kind: string };
type UsedSet = import("@/lib/core-used-pure").Used;
type Step = { step: string; detail: string; ms: number; ok: boolean; evidence?: WriteEvidence[]; answerEval?: { pass: boolean; flags: string[] }; receipt?: unknown; policy?: { verdict: "refuse"; turn: string; allowOnce?: { id: string; journal: boolean } } };
type Msg = { role: "user" | "assistant"; content: string; citations?: Cite[]; trace?: Step[]; error?: boolean; model?: "fast" | "smart" | "deep"; chips?: string[]; lesson?: { id: string; text: string }; fixes?: string[]; live?: { rows: LiveRow[]; ms: number }; used?: UsedSet };


async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

/** "What I used": one small line under the answer (memories, facts, files, tools, web; private items only as "a private note"); click for the full list. */
function UsedLine({ used }: { used: UsedSet }) {
  const { t: tr } = useT();
  const [open, setOpen] = useState(false);
  const t = (k: string, v?: Record<string, string | number>) => tr(k as Parameters<typeof tr>[0], v);
  const line = usedLine(used, t, open);
  if (!line) return null;
  return (
    <div className="mt-1.5 text-[11px] opacity-70" data-testid="core-used">
      <span className="font-medium">{tr("used.label")}:</span> <span>{line}</span>
      {(used.more > 0 || open) && <button type="button" className="ml-1.5 underline" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{tr(open ? "used.hide" : "used.showAll")}</button>}
    </div>
  );
}

/* ---------------- CORE chat ---------------- */
/** Polls a handed-off task until it finishes (or the chat moves on): its result replaces the dropped stream. */
async function waitTask(id: string, live: () => boolean): Promise<{ status: string; result?: string | null; error?: string | null } | null> {
  for (let i = 0; i < 360 && live(); i++) { // shortcut: polls up to 30 min; a longer task stays in OPERATIONS
    await new Promise((r) => setTimeout(r, 5000));
    const t = await fetch(`/api/tasks?id=${encodeURIComponent(id)}`).then((r) => r.json()).then((j) => (j.tasks as { id: string; status: string; result?: string; error?: string }[] | undefined)?.find((x) => x.id === id), () => undefined);
    if (t && ["done", "failed", "cancelled", "interrupted", "blocked"].includes(t.status)) return t;
  }
  return null;
}

export function CorePanel({ initial, initialSkill, initialHere, onConsumed, onOpenMemory, greeting, onGreeted }: { initial: string | null; initialSkill?: SkillLaunch; initialHere?: DeepLink | null /* the planet the Ask came from */; onConsumed: () => void; onOpenMemory: (id: string) => void; greeting?: string | null; onGreeted?: () => void }) {
  const { t: tr, lang } = useT();
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
  const [rows, setRows] = useState<LiveRow[]>([]); // this turn's live steps (core-live-pure.ts)
  const [route, setRoute] = useState<"fast" | "smart" | "deep" | "local" | null>(null);
  const [bgTask, setBgTask] = useState<string | null>(null); // handed off: still streaming from the background turn
  const since = useRef(0);
  const [heard, setHeard] = useState(""); // last spoken question, shown as the voice transcript
  const [copied, setCopied] = useState(-1);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
    // A running turn is not stopped: it detaches and keeps going in its own chat (marked running in the list); this view starts fresh.
    if (abort.current) { view.current++; abort.current = null; setBusy(false); setLive(null); setRows([]); setBgTask(null); setRoute(null); }
    stopSpeech();
    opening.current++;
    setMsgs([]); setChatId(null); setNewProject(projectId); setSheet(false); lastQ.current = "";
  }, [setChatId]);
  const openChat = useCallback(async (id: string, fallbackProject: string | null = null) => {
    setSheet(false);
    if (id === convo.current) return;
    // Like newChat: a running turn detaches and finishes in its own chat; only Stop/Esc cancel it.
    if (abort.current) { view.current++; abort.current = null; setBusy(false); setLive(null); setRows([]); setBgTask(null); setRoute(null); }
    stopSpeech();
    const mine = ++opening.current;
    try {
      const r = await chatsApi<{ messages: Msg[] }>(undefined, `?id=${encodeURIComponent(id)}`);
      if (mine !== opening.current) return;
      if (!r.messages.length) { newChat(fallbackProject); return; } // deleted (or not this user's): start fresh
      setMsgs(r.messages.map((m) => ({ role: m.role, content: m.content, citations: m.citations, trace: m.trace, used: m.used })));
      setChatId(id); setNewProject(null);
      lastQ.current = [...r.messages].reverse().find((m) => m.role === "user")?.content ?? "";
      const pending = handoffTask(r.messages); // reopened (reload, other device) while its background task runs: show the answer when it lands
      if (pending) void waitTask(pending, () => alive.current && mine === opening.current).then(async (t) => {
        if (!t || mine !== opening.current || abort.current) return; // moved on, or a new turn is streaming: the answer shows on the next open
        const again = await chatsApi<{ messages: Msg[] }>(undefined, `?id=${encodeURIComponent(id)}`).catch(() => null); // the server wrote it before closing the task
        if (again?.messages.length && mine === opening.current && !abort.current) setMsgs(again.messages.map((m) => ({ role: m.role, content: m.content, citations: m.citations, trace: m.trace, used: m.used })));
      });
    } catch (e) { if (mine === opening.current) { setMsgs([{ role: "assistant", content: e instanceof Error ? e.message : "Couldn't open that chat", error: true }]); setChatId(null); } }
  }, [setChatId, newChat]);
  // Reopen the last chat on mount (the panel remounts each time it opens); palette/voice "new chat" starts fresh.
  useEffect(() => {
    let last: string | null = null;
    try { last = localStorage.getItem(ACTIVE_CHAT_KEY); } catch { /* private mode */ }
    const readRequest = () => {
      try { const raw = sessionStorage.getItem(CORE_PROJECT_REQUEST_KEY); sessionStorage.removeItem(CORE_PROJECT_REQUEST_KEY); return raw ? projectChatRequest(JSON.parse(raw)) : null; }
      catch { return null; }
    };
    const openProject = (target: NonNullable<ReturnType<typeof projectChatRequest>>) => {
      void chats.reload();
      if (target.chatId) void openChat(target.chatId, target.projectId); else newChat(target.projectId);
    };
    const requested = readRequest();
    if (requested) openProject(requested);
    else if (last && !initial && !greeting) void openChat(last);
    const h = (event: Event) => {
      const target = projectChatRequest((event as CustomEvent).detail) ?? readRequest();
      try { sessionStorage.removeItem(CORE_PROJECT_REQUEST_KEY); } catch { /* no stored request */ }
      if (target) openProject(target); else newChat();
    };
    const openReceipt = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id) void openChat(id);
    };
    addEventListener(CORE_NEW_CHAT, h);
    addEventListener(CORE_OPEN_SKILL_CHAT, openReceipt);
    return () => {
      removeEventListener(CORE_NEW_CHAT, h);
      removeEventListener(CORE_OPEN_SKILL_CHAT, openReceipt);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const project = (chatId ? chats.map[chatId] : null) ?? newProject; // newProject covers a just-created chat before the list reloads
  const pin = async (text: string, title?: string) => {
    if (!project) return;
    if (await chats.act({ action: "pin", projectId: project, text: text.replace(/\s*\[[ma]:[^\]]+\]/g, ""), title })) { setPinned(text); setTimeout(() => setPinned(""), 1500); }
  };
  const end = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const view = useRef(0); // bumped by "+ New" during a turn: that turn's stream stops touching this view
  const [running, setRunning] = useState<string[]>([]); // chats with a turn still streaming (detached ones included)
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
    // Closing the chat leaves a running turn alone: the server finishes it and saves the answer to the conversation (Stop still aborts).
    // shortcut: a reload or closed tab still drops the request and stops the turn; hand it to the background turn if that bites.
    return () => { alive.current = false; setTimeout(() => { if (!alive.current && !flying.current) stopSpeech(); }, 0); };
  }, []);

  const send = useCallback(async (text: string, fromVoice?: boolean, look?: Preset, skill?: SkillLaunch, at?: DeepLink | null) => {
    const message = text.trim();
    const mine = view.current, here = () => mine === view.current;
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
    const say = (parts: string[]) => { if (talk && here() && speechSettings().speak) parts.forEach((p) => speakChunk(p, myGen)); };
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
    corePhase({ type: "submit" });
    setRows([]); setBgTask(null); setRoute(null);
    since.current = Date.now();
    let steps: LiveRow[] = []; // mirrors `rows` so "done" can keep them under the answer
    let handedOff = false, bgId = "";
    // Diagnostics for a dropped stream (seen only on the Windows PC, ~5 min in): how long it ran and how long the tab was hidden
    const doc = typeof document === "undefined" ? null : document; // tests drive send() without a DOM
    let hiddenMs = 0, hiddenAt = doc?.hidden ? Date.now() : 0;
    const onVis = () => { if (doc?.hidden) hiddenAt = Date.now(); else if (hiddenAt) { hiddenMs += Date.now() - hiddenAt; hiddenAt = 0; } };
    doc?.addEventListener("visibilitychange", onVis);
    const ac = new AbortController();
    abort.current = ac;
    let partial = "";
    let navTo: NavTarget | null = null; // CORE's navigate tool: fly once the answer is done, so leaving the panel can't cut it off
    let cid = "";
    const pacer = createPacer((t) => { if (here()) setLive(t); }); // ui-motion: bursts spread over a few frames (off: one render per frame, as before)
    const flush = () => pacer.stop();
    try {
      const res = await fetch("/api/core?stream=1", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal,
        body: JSON.stringify({ message, conversationId: convo.current, projectId: convo.current ? undefined : newProject ?? undefined, voice: talk, lang: getLang(), here: at ?? hereLink(), screen: look ? true : undefined, attachments: files.length ? files.map((f) => ({ name: f.name, data: f.data })) : undefined }),
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
        const ev = JSON.parse(line) as { type: string; conversationId?: string; text?: string; answer?: string; citations?: Cite[]; trace?: Step[]; used?: UsedSet; error?: string; to?: NavTarget; label?: string; tool?: string; taskId?: string; model?: "fast" | "smart" | "deep"; lesson?: { id: string; text: string } };
        if (ev.conversationId && !cid) { const id = cid = ev.conversationId; setRunning((r) => [...r, id]); }
        if (skill) {
          if (ev.type === "start" && cid) updateSkillRun(skill, { state: "started", chatId: cid });
          else if (ev.type === "background" && ev.taskId) updateSkillRun(skill, { taskId: ev.taskId });
          else if (ev.type === "bg_done") updateSkillRun(skill, { state: "finished" }); // fires on failure and cancel too: the task row says which
          else if (ev.type === "done" && !handedOff && !bgId) updateSkillRun(skill, { state: turnRunState(ev.trace) });
          else if (ev.type === "error") updateSkillRun(skill, { state: "failed" });
        }
        if (!here()) {
          if (ev.type === "background" && ev.taskId) { handedOff = true; bgId = ev.taskId; }
          if (ev.type === "done" || ev.type === "error") finished = true; return; } // detached by "+ New": the server finishes and saves it in its own chat
        if (ev.conversationId && ev.conversationId !== convo.current) { setChatId(ev.conversationId); void chats.reload(); }
        if (ev.type === "route" && (ev.model === "fast" || ev.model === "smart" || ev.model === "deep" || ev.model === "local")) {
          setRoute(ev.model);
        } else if (ev.type === "delta" && ev.text) {
          partial += ev.text;
          say(voiceOut.push(ev.text));
          // One render per frame at most, and only the streaming bubble changes.
          pacer.push(partial);
          corePhase({ type: "delta" });
        } else if (ev.type === "step" || ev.type === "step_done") {
          steps = applyLive(steps, ev as unknown as LiveEvent); setRows(steps);
          if (ev.type === "step" && ev.tool) dispatchEvent(new CustomEvent<CoreSignal>(CORE_SIGNAL, { detail: { type: "step", tool: ev.tool } })); // the singularity shows it (E4)
          corePhase(ev.type === "step" ? { type: "tool", tool: ev.tool ?? ev.label ?? "" } : { type: "tool_end" });
        } else if (ev.type === "navigate" && ev.to) {
          navTo = ev.to;
        } else if (ev.type === "reset") {
          partial = "";
          pacer.push("");
          voiceOut.reset();
          if (talk && speechGen() === myGen) { stopSpeech(); myGen = speechGen(); } // restart, unless the user already silenced it
          setLive("");
        } else if (ev.type === "background" && ev.taskId) {
          handedOff = true; bgId = ev.taskId; setBgTask(ev.taskId);
        } else if (ev.type === "bg_done") {
          flush(); setLive(null); partial = "";
          setMsgs((m) => [...m, { role: "assistant", content: ev.answer ?? "", live: { rows: steps, ms: Date.now() - since.current } }]);
        } else if (ev.type === "done") {
          finished = true;
          flush();
          corePhase({ type: "done" });
          // The final answer equals the streamed text up to citation markers (stripped for speech): speak only the tail.
          say(partial.trim() ? voiceOut.flush() : speechChunks(ev.answer ?? "", true));
          setLive(null);
          setMsgs((m) => [...m, { role: "assistant", content: ev.answer ?? "", citations: ev.citations, trace: ev.trace, used: ev.used, model: ev.model, live: { rows: steps, ms: Date.now() - since.current },
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
      if (navTo && here()) fly(navTo); // after the stream closed: leaving the panel aborts the request, which mustn't land mid-read
    } catch (e) {
      if (skill && !bgId) updateSkillRun(skill, { state: ac.signal.aborted ? "cancelled" : "failed" });
      const stopped = ac.signal.aborted;
      if (talk) stopSpeech();
      if (!stopped) ac.abort(); // e.g. a malformed line: stop the server-side CLI too
      if (!stopped) dispatchEvent(new CustomEvent<CoreSignal>(CORE_SIGNAL, { detail: { type: "error" } }));
      corePhase({ type: stopped ? "reset" : "error" });
      if (handedOff && !stopped && bgId) { // the stream dropped (sleep, proxy, server timeout) but the task runs on the server: wait for it
        const t = await waitTask(bgId, here);
        if (t && here()) setMsgs((m) => [...m, t.status === "done" ? { role: "assistant", content: t.result ?? "", live: { rows: steps, ms: Date.now() - since.current } }
          : { role: "assistant", content: t.error || `The task ended as ${t.status}.`, error: true }]);
      } else if (!(stopped && handedOff) && here()) setMsgs((m) => [...m, stopped // after a handoff, Stop only stops watching: the work goes on in OPERATIONS
        ? { role: "assistant", content: `${partial}${partial ? "\n\n" : ""}_Stopped._`, live: { rows: steps, ms: Date.now() - since.current } }
        : { role: "assistant", content: dropNote(e instanceof Error ? e.message : "CORE failed", Date.now() - since.current, hiddenMs + (hiddenAt ? Date.now() - hiddenAt : 0), !!doc?.hidden), error: true }]);
    } finally {
      doc?.removeEventListener("visibilitychange", onVis);
      flush();
      if (cid) setRunning((r) => r.filter((x) => x !== cid));
      if (here()) { setLive(null); setRows([]); setBgTask(null); setRoute(null); setBusy(false); }
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
  const queued = useRef<{ text: string; skill?: SkillLaunch; here?: DeepLink | null } | null>(null);
  useEffect(() => {
    if (!initial) { sentInitial.current = null; return; }
    const key = initialSkill?.runId ?? initial;
    if (sentInitial.current === key) return;
    sentInitial.current = key;
    onConsumed();
    // Busy: never drop the new question (e.g. a voice follow-up).
    // A cancel stops the job; any other follow-up (talking over CORE included) waits for it to finish.
    if (busy) { if (cancelsJob(initial)) { abort.current?.abort(); stopSpeech(); } else {
      if (queued.current?.skill) updateSkillRun(queued.current.skill, { state: "cancelled" }); // replaced by a newer question before it ran
      queued.current = { text: initial, skill: initialSkill, here: initialHere };
    } }
    else void send(initial, undefined, undefined, initialSkill, initialHere);
  }, [initial, initialSkill]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (busy || !queued.current) return;
    const q = queued.current;
    queued.current = null;
    void send(q.text, undefined, undefined, q.skill, q.here);
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  // Follow the answer only while the reader is at the bottom: scrolling up to read keeps its place (audit 8 Nov).
  // Only the chat list scrolls (scrollIntoView also moved the drawer and the page, pushing the header away). "Latest" brings you back.
  const atBottom = useRef(true);
  const [behind, setBehind] = useState(false); // scrolled up while there is newer text below
  useEffect(() => {
    const box = end.current?.parentElement;
    if (!box) return;
    const on = () => { atBottom.current = nearBottom(box.scrollHeight, box.scrollTop, box.clientHeight); if (atBottom.current) setBehind(false); };
    box.addEventListener("scroll", on, { passive: true });
    return () => box.removeEventListener("scroll", on);
  }, []);
  const toBottom = useCallback(() => { const box = end.current?.parentElement; if (box) box.scrollTop = box.scrollHeight; atBottom.current = true; setBehind(false); }, []);
  useEffect(() => { atBottom.current = true; }, [msgs.length]); // a new message (yours or CORE's) jumps back down
  useEffect(() => { if (atBottom.current) toBottom(); else setBehind(true); }, [msgs, busy, live, toBottom]);

  // Edit / Retry the last question: the server drops it and its answer (rewind), then it is asked again (Retry) or put back in the box (Edit).
  const lastUser = msgs.reduce((n, m, k) => (m.role === "user" ? k : n), -1);
  const rewind = useCallback(async () => {
    if (!chatId) return true;
    try { await chatsApi({ action: "rewind", id: chatId }); } catch (e) { setMsgs((m) => [...m, { role: "assistant", content: e instanceof Error ? e.message : "Couldn't change the chat", error: true }]); return false; }
    setMsgs((m) => m.slice(0, m.reduce((n, x, k) => (x.role === "user" ? k : n), m.length)));
    return true;
  }, [chatId]);
  const edit = useCallback(async (text: string) => {
    if (busy || !(await rewind())) return;
    setInput(text.replace(/\n📎 [^\n]*$/, ""));
    requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  }, [busy, rewind]);
  const retry = useCallback(async () => { const q = lastQ.current; if (q && !busy && (await rewind())) void send(q); }, [busy, rewind, send]);
  // Long work: past LONG_TURN_MS or handed to the background, the turn shows the shared "Working on it" card.
  const [long, setLong] = useState(false);
  useEffect(() => { if (!busy) { setLong(false); return; } const t = setTimeout(() => setLong(true), LONG_TURN_MS); return () => clearTimeout(t); }, [busy]);
  useEffect(() => { if (bgTask) setLong(true); }, [bgTask]);
  // Drag-over shows a calm drop zone over the chat; the composer box grows with the text (Shift+Enter = new line).
  const [dragging, setDragging] = useState(false);
  const drags = useRef(0);
  useEffect(() => { const el = inputRef.current; if (!el) return; el.style.height = "auto"; if (input) el.style.height = `${Math.min(el.scrollHeight, 200)}px`; }, [input]); // empty: one line, however long the placeholder
  // Screen look + voice memo: always there on a wide screen; on a phone behind one "⋯" button so the chat keeps its room.
  const [tools, setTools] = useState(true);
  useEffect(() => { setTools(!matchMedia("(max-width: 640px)").matches); }, []);

  // Memoised so streaming deltas re-render only the live bubble, not the whole history.
  const history = useMemo(() => msgs.map((m, i) => (
    <div key={i} className={m.role === "user" ? "bubble user" : `bubble core${m.error ? " err" : ""}`}>
      {/* Steps sit above the answer (as while it streams), so the answer never jumps when the turn ends. */}
      {m.live && <CoreActivity rows={m.live.rows} running={false} totalMs={m.live.ms} />}
      {m.role === "assistant" && !m.error
        ? <ChatAnswer text={numberCitations(withoutCard(m.content), (m.citations ?? []).map((c) => c.id))} openMemory={onOpenMemory} />
        : <div className="whitespace-pre-wrap">{m.content}</div>}
      {m.role === "assistant" && m.trace?.some((x) => x.step === "local") && <p className="muted mt-1 text-xs" role="note">{tr("core.offlineNote")}</p>}
      {m.role === "user" && i === lastUser && !busy && chatId && (
        <div className="mt-1.5 flex justify-end text-xs"><button type="button" className="chat-mini" title={tr("chat.editTitle")} onClick={() => void edit(m.content)}>✎ {tr("chat.edit")}</button></div>
      )}
      {m.role === "assistant" && !m.error && (() => { const g = parseGoalCard(m.content); return g && <GoalCardView card={g} onChange={() => { setInput(""); inputRef.current?.focus(); }} />; })()}
      {!!m.citations?.length && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {m.citations.map((c, n) => <button key={c.id} className="chip" onClick={() => (c.kind.startsWith("week:") ? dispatchEvent(new CustomEvent(OPEN_SOURCE_EVENT, { detail: c })) : onOpenMemory(c.id))}>[{n + 1}] {c.title}</button>)}
        </div>
      )}
      {m.role === "assistant" && !m.error && m.used && <UsedLine used={m.used} />}
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
            <button type="button" className="chip" title={tr(chatId ? "chat.retryTitle" : "core.retryTitle")} onClick={() => void retry()}>↻ {tr("task.retry")}</button>
          )}
          {m.trace?.some((x) => x.step === "local") && <span className="chip !py-0 !text-[10px]" title={tr("core.localTitle")} role="status">{tr("core.local")}</span>}
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
        <><ReceiptChip receipt={m.trace.findLast((s) => s.receipt)?.receipt} /><DeliverableCards items={m.trace.flatMap((s) => s.evidence ?? [])} /><ResultEvidence items={m.trace.flatMap((s) => s.evidence ?? [])} openMemory={onOpenMemory} /></>
      )}
      {!!m.trace?.length && (
        <details className="mt-2 text-xs muted">
          <summary className="cursor-pointer">{tr("core.trace")}</summary>
          <ul className="mt-1 space-y-0.5">{m.trace.map((s, n) => <li key={n}>{s.ok ? "✓" : "✗"} <b>{s.step}</b> · {s.ms}ms · {s.detail}</li>)}</ul>
        </details>
      )}
      {!busy && m.trace?.map((s, n) => s.policy?.allowOnce && <AllowOnceCard key={s.policy.allowOnce.id} id={s.policy.allowOnce.id} tool={s.step} journal={s.policy.allowOnce.journal} onRetry={() => void send(tr("once.retry"))} />)}
      {m.role === "assistant" && turnFailed(m) && (
        <div className="mt-2"><FailureReport input={{ kind: "turn", id: chatId, relatedIds: chatId ? [chatId] : [], model: m.model ?? null, error: m.error ? m.content : null,
          trace: m.trace ?? [], request: msgs[i - 1]?.role === "user" ? msgs[i - 1].content : "", answer: m.error ? "" : m.content }} /></div>
      )}
    </div>
  )), [msgs, onOpenMemory, speaking, copied, busy, send, project, pinned, tr, chatId, lastUser]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastCore = [...msgs].reverse().find((m) => m.role === "assistant" && !m.error);
  const artifact = useMemo(() => (lastCore ? turnArtifact(lastCore.content) : null), [lastCore]);
  const mission = busy ? missionOf([], rows.map((r) => r.label), true) : missionOf(lastCore?.trace, [], false, !!artifact) // while busy, the old turn's steps aren't this job's;
  return (
    <div className="core-ws">
    <div className="relative flex h-full min-h-0 min-w-0 flex-col" onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
      onDragEnter={(e) => { if (e.dataTransfer.types.includes("Files")) { drags.current++; setDragging(true); } }}
      onDragLeave={() => { if (--drags.current <= 0) { drags.current = 0; setDragging(false); } }}
      onDrop={(e) => { drags.current = 0; setDragging(false); if (e.dataTransfer.files.length) { e.preventDefault(); void att.add(e.dataTransfer.files); } }}>
      {dragging && <div className="chat-drop" aria-hidden="true"><span>📎 {tr("chat.drop")}</span></div>}
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
      {sheet && <ChatSheet {...chats} activeId={chatId} running={running} onOpen={(id) => void openChat(id)} onNew={newChat} onClose={() => setSheet(false)}
        onDeleted={(id) => { if (id === chatId) newChat(); }} />}
      <CoreSuggests tick={msgs.length} busy={busy} />
      <PlanCard tick={msgs.length} />
      <div className="flex-1 space-y-4 overflow-y-auto pr-1" aria-live="polite" aria-busy={busy}>
        {!msgs.length && <p className="muted">{tr("core.intro")}</p>}
        {history}
        {busy && <div className="bubble core">
              {/* Steps first, text under them: new text only ever grows downwards, so nothing above it moves while it streams.
                  Long work (handed off, or past LONG_TURN_MS) shows the shared "Working on it" card instead of the step list. */}
              <CorePresence className="mb-2" />
              {long ? <ProgressCard p={turnProgress({ id: bgTask ?? "turn", title: lastQ.current.slice(0, 80) || tr("prog.title"), rows, streaming: !!live, taskId: bgTask, startedAt: since.current, lang,
                  label: (r) => (r.key ? tr(r.key as Parameters<typeof tr>[0], (r as LiveRow).vars) : r.label.replace(/…$/, "")) })} />
                : <CoreActivity rows={rows} running streaming={!!live} since={since.current} taskId={bgTask} route={route} projectName={chats.projects.find((p) => p.id === project)?.name} />}
              {/* Citation numbers arrive with the final answer; hide raw [m:id] markers until then. */}
              {live && <><LiveAnswer text={numberCitations(live, [])} openMemory={onOpenMemory} />
              <span aria-hidden className="chat-caret" /></>}
            </div>}
        {behind && <button type="button" className="chat-latest" onClick={toBottom}>↓ {tr("chat.latest")}</button>}
        <div ref={end} />
      </div>
      <AttachChips items={att.items} error={att.error} onRemove={att.remove} />
      {(tools || lookAsk) && <ScreenLook busy={busy} input={input} ask={lookAsk} onAsk={setLookAsk} run={async (file, text, preset) => { await att.add([file]); await send(text, false, preset); }} />}
      {tools && <VoiceMemo compact />}
      <form className="chat-composer mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <input ref={fileRef} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden aria-label={tr("core.attach")} onChange={(e) => { if (e.target.files) void att.add(e.target.files); e.target.value = ""; }} />
        <button type="button" className="btn" title={tr("core.attachTitle")} aria-label={tr("core.attach")} disabled={busy} onClick={() => fileRef.current?.click()}>📎</button>
        {!tools && <button type="button" className="btn" aria-label={tr("chat.tools")} title={tr("chat.tools")} onClick={() => setTools(true)}>⋯</button>}
        <textarea ref={inputRef} rows={1} className="field chat-input flex-1" value={input} onChange={(e) => setInput(e.target.value)} onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); void att.add(e.clipboardData.files); } }} placeholder={tr("core.ph")}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" && !input && lastQ.current) { e.preventDefault(); setInput(lastQ.current); return; }
            if (composerKey(e.nativeEvent) === "send") { e.preventDefault(); void send(input); }
          }} maxLength={8000} aria-label={tr("core.message")} enterKeyHint="send" />
        {busy
          ? <button type="button" className="btn chat-stop" onClick={() => { abort.current?.abort(); stopSpeech(); }} aria-label={tr("core.stop")}>■ {tr("core.stop")}</button>
          : speaking && !input.trim()
            ? <button type="button" className="btn" onClick={stopSpeech}>{tr("core.stop")}</button>
            : <button className="btn" disabled={!input.trim() && !att.items.length}>{tr("core.send")}</button>}
      </form>
    </div>
    <CoreWorkspace artifact={artifact} mission={mission} busy={busy} heard={heard} onAsk={(t) => void send(t)} />
    </div>
  );
}

/** "CORE suggests": one compact line (count + expand) over up to 3 proactive suggestions (src/lib/insights-pure.ts),
 *  each with its one-click action and dismiss. Hidden while a turn runs, so the chat keeps its height. */
/** The answer while it streams: fresh words fade in (ui-motion; plain text without it). */
function LiveAnswer({ text, openMemory }: { text: string; openMemory?: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useStreamFade(ref, text, true);
  return <div ref={ref} className="contents"><ChatAnswer text={text} openMemory={openMemory} streaming /></div>;
}

function CoreSuggests({ tick, busy }: { tick: number; busy: boolean }) {
  const { t: tr } = useT();
  const [open, setOpen] = useState(false);
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
  if (!items.length || busy) return null;
  return (
    <section className="mb-2 space-y-1.5" aria-label={tr("core.suggests")}>
      <button type="button" className="muted flex w-full items-center gap-2 truncate text-left text-xs" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="uppercase tracking-wide">{tr("core.suggests")} · {Math.min(3, items.length)}</span>
        {!open && <span className="min-w-0 flex-1 truncate">{items[0].title}</span>}
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open && items.slice(0, 3).map((s) => (
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
