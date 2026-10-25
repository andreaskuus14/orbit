// "ORBIT wants to talk", server glue: ringing the paired phone (scheduler tick → call-pure decideCall → push), live call
// sessions (Whisper in, CORE with the call style, Kokoro out sentence by sentence), voice approvals through decideApproval,
// and the memory note when the call ends. Audio is only ever in memory for one request; the call transcript lives in this
// process until the call ends, then only the summary note is saved. Rules: call-pure.ts; route: /api/remote/talk.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { askClaude, emit, FAST_MODEL, recordUsage } from "./claude";
import { runCore } from "./core";
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
  CALL, SUMMARY_SYSTEM, backchannel, callStyle, decideCall, fallbackSummary, localParts, opener, parseCallState, takeSentences, transcriptText, voiceDecision,
  type CallItem, type CallReason, type CallState, type CallTurn, type Pending,
} from "./call-pure";

type Session = { id: string; userId: string; sb: SupabaseClient; reason: CallReason; turns: CallTurn[]; pending: Pending | null; done: string[]; n: number; lastAt: number; busy?: AbortController };
type G = { sessions: Map<string, Session>; ring: { reason: CallReason; at: number } | null; checkedAt: number; save?: Promise<unknown>; tts: Promise<unknown>; cache: Map<string, string>; sweep?: NodeJS.Timeout };
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
    const [items, report] = await Promise.all([pendingApprovals(sb), readSleepReport(dev.userId).catch(() => undefined)]);
    let ring: ReturnType<typeof decideCall>["ring"] = null;
    await update((s) => { const r = decideCall(s, { now, stopAll: stopAllOn(), approvals: items.map((i) => i.id), nightReport: report?.day === localDay(new Date(now)) }); ring = r.ring; return r.state; });
    if (!ring) return;
    const { reason, things } = ring as NonNullable<typeof ring>;
    G.ring = { reason, at: now };
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
/** Load Kokoro and make the short fillers ahead of the first turn. */
export const warmVoice = () => { for (const t of ["Mm-hm.", "Okay.", "Hmm, let me check.", "One sec."]) void tts(t); };

const toItems = (sb: SupabaseClient): Promise<CallItem[]> =>
  pendingApprovals(sb).then((a) => a.map(({ id, kind, title, seen, credits, to, thumb }) => ({ id, kind, title, seen, credits, to, thumb })));

// ---- Sessions ----
function sweep() {
  G.sweep ??= setInterval(() => {
    for (const s of G.sessions.values()) if (!s.busy && Date.now() - s.lastAt > CALL.idleEndMs) void endCall(s.userId, s.id);
  }, 60_000);
  G.sweep.unref?.();
}

export async function startCall(sb: SupabaseClient, userId: string): Promise<{ id: string; reason: CallReason; say: Spoken[] }> {
  for (const s of [...G.sessions.values()]) void endCall(s.userId, s.id); // one call at a time
  const reason = ringing() ?? "manual";
  G.ring = null;
  const items = await toItems(sb).catch(() => []);
  const text = opener(reason, localParts(Date.now()).h, items);
  const id = randomUUID();
  G.sessions.set(id, { id, userId, sb, reason, turns: [{ role: "assistant", content: text }], pending: null, done: [], n: 0, lastAt: Date.now() });
  sweep();
  warmVoice();
  void emit(sb, userId, "call.started", "core", { callId: id, reason });
  return { id, reason, say: [{ text, audio: await tts(text) }] };
}

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
      let chain = Promise.resolve(), spoken: string[] = [];
      const say = (text: string) => {
        spoken.push(text);
        const audio = tts(text);
        chain = chain.then(async () => { const a = await audio; if (ac.signal.aborted) return; ms.first_audio ??= Date.now() - t0; send({ type: "say", text, audio: a }); });
      };
      try {
        const heard = input.text ?? cleanWhisperText(await transcribeSpeech(input.audio!));
        ms.asr = Date.now() - t0;
        send({ type: "heard", text: heard });
        if (!heard.trim()) return;
        s.turns.push({ role: "user", content: heard });
        const items = await toItems(s.sb);
        const d = voiceDecision(s.pending, heard, items, Date.now());
        if (d) {
          s.pending = d.pending;
          if (d.act) {
            const r = await decideApproval(s.sb, s.userId, d.act.id, d.act.action, d.act.echo);
            const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
            void emit(s.sb, s.userId, "call.action", "core", { callId: s.id, approval: d.act.id, action: d.act.action, ok: r.ok });
            if (r.ok) s.done.push(`${d.act.action === "approve" ? "approved" : "rejected"} ${d.act.echo.kind === "send" ? "an email" : d.act.echo.kind === "spend" ? "a Higgsfield spend" : "a clip"}`);
            say(r.ok ? `Done, ${(j.message ?? "it's through").replace(/:.*$/, "").replace(/^\w/, (c) => c.toLowerCase())}.`
              : `I couldn't do that. ${(j.error ?? "Check ORBIT on the PC").replace(/[:.]\s*reload\.?$/i, "")}.`);
          } else if (d.say) say(d.say);
        } else {
          let buf = "", got = false;
          const filler = setTimeout(() => { if (!got) say(backchannel(heard, s.n)); }, 800); // the real answer is still coming: "Mm-hm."
          try {
            const out = await runCore(s.sb, s.userId, s.turns.slice(-CALL.maxTurns), (delta) => {
              buf += delta;
              const r = takeSentences(buf);
              buf = r.rest;
              for (const t of r.done) { got = true; say(t); }
            }, ac.signal, () => { buf = ""; }, callStyle(items));
            const r = takeSentences(buf, true);
            const rest = got ? r.done : takeSentences(out.text, true).done; // nothing streamed (e.g. a reflex): speak the answer
            got ||= rest.length > 0;
            rest.forEach(say);
          } finally { clearTimeout(filler); }
        }
        await chain;
      } catch (e) {
        if (!ac.signal.aborted) { console.error("[call] turn:", e instanceof Error ? e.message : e); send({ type: "error", error: "I lost that one. Say it again?" }); }
      } finally {
        if (spoken.length) s.turns.push({ role: "assistant", content: spoken.join(" ") + (ac.signal.aborted ? " (he cut in here)" : "") });
        if (s.turns.length > CALL.maxTurns * 2) s.turns.splice(1, s.turns.length - CALL.maxTurns * 2); // keep the opener
        s.n++; s.lastAt = Date.now();
        if (s.busy === ac) s.busy = undefined;
        console.info(`[call] turn ${Object.entries({ ...ms, total: Date.now() - t0 }).map(([k, v]) => `${k}=${v}ms`).join(" ")}`);
        send({ type: "done", ms });
        try { ctrl.close(); } catch { /* cancelled */ }
      }
    },
    cancel() { s.busy?.abort(); },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}

/** Hang up: a short summary note into memory (kind conversation, not journal) and a ledger event with ids only. */
export async function endCall(userId: string, id: string): Promise<{ memoryId: string | null }> {
  const s = getCall(userId, id);
  if (!s) return { memoryId: null };
  G.sessions.delete(id);
  s.busy?.abort();
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
