// "ORBIT wants to talk", server glue: ringing the paired phone (scheduler tick → call-pure decideCall → push), live call
// sessions (Whisper in, CORE with the call style, Kokoro out sentence by sentence), voice approvals through decideApproval,
// and the memory note when the call ends. Audio is only ever in memory for one request; the call transcript lives in this
// process until the call ends, then only the summary note is saved. Rules: call-pure.ts; route: /api/remote/talk.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { askClaude, coolClaude, emit, FAST_MODEL, recordUsage } from "./claude";
import { runCore, warmCore } from "./core";
import { createMemory } from "./memory";
import { listDevices, ownerClient, pendingApprovals } from "./remote";
import { decideApproval } from "./remote-act";
import { deliver, pushProblem } from "./remote-push";
import { pushLabel } from "./remote-push-pure";
import { readSleepReport } from "./sleep";
import { stopAllOn } from "./stop-all";
import { localDay } from "./morning-pure";
import { transcribeSpeech } from "./voice-asr";
import { kokoroTts } from "./clips/story";
import { encodeWav } from "./audio-pure";
import { cleanWhisperText } from "@/components/voice/hear";
import {
  CALL, FILLERS, OPENER_SYSTEM, SUMMARY_SYSTEM, backchannel, callStyle, cleanOpener, decideCall, fallbackSummary, itemsKey, localParts, opener, openerPrompt, parseCallState,
  phraseKey, quickReply, takeSentences, transcriptText, voiceDecision, whenLabel,
  type CallItem, type CallReason, type CallState, type CallTurn, type Pending,
} from "./call-pure";

type Session = { id: string; userId: string; sb: SupabaseClient; reason: CallReason; turns: CallTurn[]; pending: Pending | null; done: string[]; n: number; lastAt: number; busy?: AbortController; said: Set<string> };
/** An opener made ahead (when ORBIT rings, or while the call screen is open): its text and its first sentence's audio. */
type Voiced = { text: string; parts: string[]; audio: Promise<string | null>[] };
type Pre = { reason: CallReason; at: number; key: Promise<string>; base: Promise<string>; voiced: Promise<Voiced> };
type G = { sessions: Map<string, Session>; ring: { reason: CallReason; at: number } | null; checkedAt: number; save?: Promise<unknown>; tts: Promise<unknown>; cache: Map<string, string>; sweep?: NodeJS.Timeout; pre?: Pre };
const g = globalThis as unknown as { __orbitCall?: G };
const G: G = (g.__orbitCall ??= { sessions: new Map(), ring: null, checkedAt: 0, tts: Promise.resolve(), cache: new Map() });
const RING_MS = 30 * 60_000; // a ring older than the push's TTL is just a normal call
const VOICE = () => process.env.ORBIT_CALL_VOICE || "af_heart";

// ---- State file: <data dir>/call.json (counters, first-seen times, check-in time; no content) ----
const file = () => path.join(orbitDataDir(), "call.json");
const load = async () => parseCallState(await readFile(file(), "utf8").catch(() => ""));
function update(fn: (s: CallState) => CallState): Promise<CallState> {
  const p = (G.save ?? Promise.resolve()).catch(() => {}).then(async () => {
    const next = fn(await load());
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(next));
    await rename(file() + ".tmp", file());
    return next;
  });
  G.save = p;
  return p;
}

export const callSettings = async () => ({ checkin: (await load()).checkin });
export const setCheckin = (checkin: string) => update((s) => ({ ...s, checkin, checkinDay: "" }));
/** A job failed (pushNotify "failed"): the next check may ring about it. Never throws. */
export const noteUrgent = () => update((s) => ({ ...s, urgentAt: Date.now() })).catch(() => {});
/** Why ORBIT rang, if it did lately and he hasn't picked up yet. */
export const ringing = () => (G.ring && Date.now() - G.ring.at < RING_MS ? G.ring.reason : null);

/** Scheduler tick (after its Stop-all check): ring the paired phone when call-pure says so. At most every 2 min; never throws. */
export async function maybeCall(): Promise<void> {
  const now = Date.now();
  if (now - G.checkedAt < 120_000 || G.sessions.size || pushProblem()) return;
  G.checkedAt = now;
  try {
    const dev = (await listDevices()).find((d) => d.push);
    if (!dev) return;
    const sb = await ownerClient(dev.userId);
    const [items, report, deals] = await Promise.all([pendingApprovals(sb), readSleepReport(dev.userId).catch(() => undefined), import("./deals").then((d) => d.freshDeals(now), () => ({ ids: [] }))]);
    let ring: ReturnType<typeof decideCall>["ring"] = null;
    await update((s) => { const r = decideCall(s, { now, stopAll: stopAllOn(), approvals: items.map((i) => i.id), nightReport: report?.day === localDay(new Date(now)), deals: deals.ids }); ring = r.ring; return r.state; });
    if (!ring) return;
    const { reason, things } = ring as NonNullable<typeof ring>;
    G.ring = { reason, at: now };
    G.pre = prepareOpener(sb, dev.userId, reason); // ready before he picks up: answering is instant
    const sent = await deliver(pushLabel("call", things)); // label only: never what the things are
    void emit(sb, dev.userId, "call.rang", "core", { reason, things, delivered: sent });
  } catch (e) {
    console.error("[call] ring check failed:", e instanceof Error ? e.message : e);
  }
}

// ---- Voice out: Kokoro on this PC, one sentence at a time, as a 16-bit WAV (base64) ----
export type Spoken = { text: string; audio: string | null };
function tts(text: string): Promise<string | null> {
  const hit = G.cache.get(text);
  if (hit) return Promise.resolve(hit);
  // One at a time: parallel runs share the same CPU cores and each gets slower.
  const p = G.tts.then(async () => {
    const out = await (await kokoroTts()).generate(text, { voice: VOICE() });
    return Buffer.from(encodeWav(out.audio, out.sampling_rate)).toString("base64");
  });
  G.tts = p.catch(() => {});
  return p.then((b64) => { if (text.length < 40) G.cache.set(text, b64); return b64; }, (e) => { console.error("[call] tts:", e instanceof Error ? e.message : e); return null; });
}
/** Load Kokoro and make the short fillers ahead of the first turn (cached for the life of the process). */
export const warmVoice = () => { for (const t of FILLERS) if (!G.cache.has(t)) void tts(t); };

const toItems = (sb: SupabaseClient): Promise<CallItem[]> =>
  pendingApprovals(sb).then((a) => a.map(({ id, kind, title, seen, credits, to, thumb }) => ({ id, kind, title, seen, credits, to, thumb })));

// ---- Sessions ----
function sweep() {
  G.sweep ??= setInterval(() => {
    for (const s of G.sessions.values()) if (!s.busy && Date.now() - s.lastAt > CALL.idleEndMs) void endCall(s.userId, s.id);
  }, 60_000);
  G.sweep.unref?.();
}

/** Earlier call notes from the last 6 days, newest first, with when they were ("yesterday"). */
async function callNotes(sb: SupabaseClient, userId: string): Promise<{ when: string; text: string }[]> {
  const { data, error } = await sb.from("memories").select("content, created_at").eq("user_id", userId).eq("kind", "conversation")
    .eq("source", "core-summary").contains("tags", ["call"]).order("created_at", { ascending: false }).limit(2);
  if (error) throw error;
  const today = localParts(Date.now()).day;
  return (data ?? []).flatMap((m) => { const when = whenLabel(localParts(Date.parse(m.created_at)).day, today); return when ? [{ when, text: String(m.content) }] : []; });
}

const PRE_MS = RING_MS;
/** The newest great deal for a "deal" ring's opener ("an offer came in for X"), else null. */
const dealFor = (reason: CallReason) => (reason === "deal" ? import("./deals").then((d) => d.freshDeals().then((f) => f.latest), () => null) : Promise.resolve(null));
/** An opener split into sentences, each one's audio queued now (in order, ahead of anything queued later). */
function voice(text: string): Voiced {
  const parts = takeSentences(text, true).done;
  return { text, parts, audio: parts.map(tts) };
}

/** Write the opener now (a fast-model pass adds a follow-up on earlier calls, if any) and make its audio. */
function prepareOpener(sb: SupabaseClient, userId: string, reason: CallReason): Pre {
  const at = Date.now();
  const items = toItems(sb).catch(() => [] as CallItem[]);
  const base = Promise.all([items, dealFor(reason)]).then(([it, deal]) => opener(reason, localParts(at).h, it, deal));
  const text = Promise.all([base, callNotes(sb, userId).catch(() => [])]).then(async ([b, notes]) => {
    if (!notes.length) return b;
    try {
      const r = await askClaude(openerPrompt(b, notes), OPENER_SYSTEM, { lane: "foreground", model: FAST_MODEL, timeoutMs: 20_000, purpose: "call.opener" });
      void recordUsage(sb, userId, "call.opener", r, FAST_MODEL);
      return cleanOpener(r.text, b);
    } catch (e) { console.error("[call] opener:", e instanceof Error ? e.message : e); return b; }
  });
  const voiced = text.then(voice);
  voiced.then((v) => Promise.all(v.audio)).then(() => warmVoice(), () => {}); // fillers queue behind the opener's audio
  return { reason, at, key: items.then(itemsKey), base, voiced };
}

/** The call screen is open (phone or PC page): get the next manual call's opener and the voice ready. At most every 10 min. */
export function warmCall(sb: SupabaseClient, userId: string) {
  if (G.sessions.size || ringing() || (G.pre && Date.now() - G.pre.at < 10 * 60_000)) return;
  G.pre = prepareOpener(sb, userId, "manual");
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const NDJSON = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" };

/** Pick up: NDJSON {type:"call",id,reason} then {type:"say",text,audio} per opener sentence, the first as soon as its audio is ready
 *  (made ahead when ORBIT rang). Spare Claude CLIs boot while ORBIT talks, so his first reply skips the CLI's start-up. */
export async function startCall(sb: SupabaseClient, userId: string): Promise<Response> {
  for (const s of [...G.sessions.values()]) void endCall(s.userId, s.id); // one call at a time
  const t0 = Date.now();
  const reason = ringing() ?? "manual";
  const pre = G.pre;
  G.ring = null; G.pre = undefined;
  const items = await toItems(sb).catch(() => [] as CallItem[]);
  let v: Voiced | null = null, ahead = false;
  if (pre && pre.reason === reason && t0 - pre.at < PRE_MS && (await pre.key) === itemsKey(items)) {
    v = await Promise.race([pre.voiced, wait(1500).then(() => null)]); // still personalising after 1.5 s: the plain one now
    ahead = !!v;
    v ??= voice(await pre.base);
  }
  const { text, parts, audio } = v ?? voice(opener(reason, localParts(t0).h, items, await dealFor(reason)));
  const id = randomUUID();
  const s: Session = { id, userId, sb, reason, turns: [{ role: "assistant", content: text }], pending: null, done: [], n: 0, lastAt: t0, said: new Set(parts.map(phraseKey)) };
  G.sessions.set(id, s);
  sweep();
  void emit(sb, userId, "call.started", "core", { callId: id, reason });
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (ev: Record<string, unknown>) => { try { ctrl.enqueue(enc.encode(JSON.stringify(ev) + "\n")); } catch { /* gone */ } };
      send({ type: "call", id, reason });
      const ms: Record<string, number> = {};
      for (let i = 0; i < parts.length; i++) { const a = await audio[i]; ms.first_audio ??= Date.now() - t0; send({ type: "say", text: parts[i], audio: a }); }
      send({ type: "done", ms, path: ahead ? "made ahead" : "live" });
      try { ctrl.close(); } catch { /* cancelled */ }
      warmVoice();
      void warmCore(sb, userId);
    },
  });
  return new Response(body, { headers: NDJSON });
}

/** A call is going on (on any device): the PC's "Hey Orbit" must not listen meanwhile. */
export const callLive = () => G.sessions.size > 0;

export const getCall = (userId: string, id: string) => { const s = G.sessions.get(id); return s && s.userId === userId ? s : null; };

/** One turn as NDJSON: {type:"heard",text} {type:"say",text,audio}* {type:"done",ms} | {type:"error",error}. Aborting (barge-in) stops CORE. */
export function callTurn(s: Session, input: { audio?: Float32Array; text?: string }, signal: AbortSignal): Response {
  const enc = new TextEncoder();
  const t0 = Date.now(), ms: Record<string, number> = {};
  const body = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (ev: Record<string, unknown>) => { try { ctrl.enqueue(enc.encode(JSON.stringify(ev) + "\n")); } catch { /* gone */ } };
      s.busy?.abort();
      const ac = (s.busy = new AbortController());
      signal.addEventListener("abort", () => ac.abort(), { once: true });
      s.lastAt = Date.now();
      void warmCore(s.sb, s.userId); // the last turn used the spare CLI: boot the next one while Whisper runs
      let chain = Promise.resolve(), spoken: string[] = [], path = "", end = false;
      const say = (text: string, filler = false) => {
        spoken.push(text);
        s.said.add(phraseKey(text));
        if (!filler) ms.answer_text ??= Date.now() - t0;
        const t1 = Date.now();
        const audio = tts(text).then((a) => { ms.tts_first ??= Date.now() - t1; return a; });
        chain = chain.then(async () => {
          const a = await audio;
          if (ac.signal.aborted) return;
          ms.first_audio ??= Date.now() - t0;
          if (!filler) ms.answer_audio ??= Date.now() - t0;
          send({ type: "say", text, audio: a });
        });
      };
      const waiting = toItems(s.sb); // fetched while Whisper runs
      waiting.catch(() => {});
      try {
        const heard = input.text ?? cleanWhisperText(await transcribeSpeech(input.audio!));
        ms.asr = Date.now() - t0;
        send({ type: "heard", text: heard });
        if (!heard.trim()) return;
        s.turns.push({ role: "user", content: heard });
        const items = await waiting;
        const d = voiceDecision(s.pending, heard, items, Date.now());
        const quick = d ? null : quickReply(heard, s.turns.findLast((t) => t.role === "assistant")?.content ?? "", s.said);
        if (d) {
          path = "approval";
          s.pending = d.pending;
          if (d.act) {
            const r = await decideApproval(s.sb, s.userId, d.act.id, d.act.action, d.act.echo);
            const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
            void emit(s.sb, s.userId, "call.action", "core", { callId: s.id, approval: d.act.id, action: d.act.action, ok: r.ok });
            if (r.ok) s.done.push(`${d.act.action === "approve" ? "approved" : "rejected"} ${d.act.echo.kind === "send" ? "an email" : d.act.echo.kind === "spend" ? "a Higgsfield spend" : "a clip"}`);
            say(r.ok ? `Done, ${(j.message ?? "it's through").replace(/:.*$/, "").replace(/^\w/, (c) => c.toLowerCase())}.`
              : `I couldn't do that. ${(j.error ?? "Check ORBIT on the PC").replace(/[:.]\s*reload\.?$/i, "")}.`);
          } else if (d.say) say(d.say);
        } else if (quick) {
          path = "local";
          say(quick.say);
          end = !!quick.end;
        } else {
          let buf = "", got = false;
          // The real answer is still coming: a short "Mm-hm." (never one already said in this call).
          const filler = setTimeout(() => { if (!got) { const f = backchannel(heard, s.n, s.said); if (f) say(f, true); } }, 900);
          const sayNew = (t: string) => { if (s.said.has(phraseKey(t))) return; got = true; say(t); }; // never the same line twice in a call
          try {
            const out = await runCore(s.sb, s.userId, s.turns.slice(-CALL.maxTurns), (delta) => {
              buf += delta;
              const r = takeSentences(buf);
              buf = r.rest;
              r.done.forEach(sayNew);
            }, ac.signal, () => { buf = ""; }, callStyle(items));
            ms.core = Date.now() - t0;
            path = out.trace.some((x) => x.step === "reflex") ? "reflex" : out.model;
            const r = takeSentences(buf, true);
            const rest = got ? r.done : takeSentences(out.text, true).done; // nothing streamed (e.g. a reflex): speak the answer
            rest.forEach(sayNew);
            if (!got) rest.forEach((t) => say(t)); // every line was a repeat: better said twice than silence
          } finally { clearTimeout(filler); }
        }
        await chain;
        if (end && !ac.signal.aborted) send({ type: "end" }); // he said bye: the screen hangs up once ORBIT's bye has played
      } catch (e) {
        if (!ac.signal.aborted) { console.error("[call] turn:", e instanceof Error ? e.message : e); send({ type: "error", error: "I lost that one. Say it again?" }); }
      } finally {
        if (spoken.length) s.turns.push({ role: "assistant", content: spoken.join(" ") + (ac.signal.aborted ? " (he cut in here)" : "") });
        if (s.turns.length > CALL.maxTurns * 2) s.turns.splice(1, s.turns.length - CALL.maxTurns * 2); // keep the opener
        s.n++; s.lastAt = Date.now();
        if (s.busy === ac) s.busy = undefined;
        console.info(`[call] turn ${path || "-"} ${Object.entries({ ...ms, total: Date.now() - t0 }).map(([k, v]) => `${k}=${v}ms`).join(" ")}`);
        send({ type: "done", ms, path });
        if (!end) void warmCore(s.sb, s.userId); // a spare for the next turn
        try { ctrl.close(); } catch { /* cancelled */ }
      }
    },
    cancel() { s.busy?.abort(); },
  });
  return new Response(body, { headers: NDJSON });
}

/** Hang up: a short summary note into memory (kind conversation, not journal) and a ledger event with ids only. */
export async function endCall(userId: string, id: string): Promise<{ memoryId: string | null }> {
  const s = getCall(userId, id);
  if (!s) return { memoryId: null };
  G.sessions.delete(id);
  s.busy?.abort();
  if (!G.sessions.size) coolClaude();
  let memoryId: string | null = null;
  try {
    if (s.turns.some((t) => t.role === "user")) {
      let summary = "";
      try {
        const r = await askClaude(`TRANSCRIPT:\n${transcriptText(s.turns)}${s.done.length ? `\n\nDONE ON THE CALL: ${s.done.join("; ")}` : ""}`, SUMMARY_SYSTEM, { lane: "background", model: FAST_MODEL, timeoutMs: 60_000, purpose: "call.summary" });
        void recordUsage(s.sb, userId, "call.summary", r, FAST_MODEL);
        summary = r.text.trim().slice(0, 1500);
      } catch (e) { console.error("[call] summary:", e instanceof Error ? e.message : e); }
      const m = await createMemory(s.sb, userId, { kind: "conversation", title: `Call with ORBIT, ${localDay(new Date())}`, content: summary || fallbackSummary(s.turns, s.done), source: "core-summary", tags: ["call", id] });
      memoryId = m.memory.id as string;
    }
  } catch (e) {
    console.error("[call] saving the call note failed:", e instanceof Error ? e.message : e);
  }
  s.turns = [];
  void emit(s.sb, userId, "call.ended", "core", { callId: id, memoryId, actions: s.done.length });
  return { memoryId };
}
