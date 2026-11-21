import { decodeAudioBody, MAX_AUDIO_BYTES } from "@/lib/audio-pure";
import { notePresence } from "@/lib/presence";
import { loadVoiceAsr, MAX_VOICE_QUEUE, voiceQueue } from "@/lib/voice-asr";
import { transcribe } from "@/lib/voice-io";
import { cleanWhisperText } from "@/components/voice/hear";
import { extractWakeQuestion, isSleepCommand } from "@/components/voice/wake";
import { stopAllOn } from "@/lib/stop-all";
import { deskWho, privateWindow, wakeBlocked, wantsScreen, windowLine } from "@/lib/jarvis-pure";
import { confirmReply } from "@/lib/pc-policy-pure";
import { confirmPc, fromHelper, nextPing, noteGlance, pendingPc, screenshot, wakeSettings } from "@/lib/jarvis";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The desk listener (tools/voice/orbit_voice.py), loopback + token only (jarvis.ts fromHelper); never the browser or the phone.
// GET ?op=poll&idle=<ms> → {on, blocked, peripheral, everySec, pending, say?: {text, audio}}.
// POST ?op=hear[&armed=1] body: 16 kHz mono WAV of one utterance, header x-orbit-window: {"app","title"} →
//   {wake:false} (no wake phrase: the transcript is dropped, never logged) | {armed:true, say} (a bare "Hey Orbit") |
//   NDJSON {type:"heard"} {type:"say",text,audio}* {type:"done"} from the call engine (barge-in = the helper closes the request).
// POST ?op=glance {app,title} (peripheral mode; private windows are dropped). POST ?op=confirm {id, allow} (his click on the orb).
const fail = (error: string, status = 400) => Response.json({ error }, { status });
const NDJSON = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" };
const lines = (evs: Record<string, unknown>[]) => new Response(evs.map((e) => JSON.stringify(e) + "\n").join(""), { headers: NDJSON });

async function gate() {
  const settings = await wakeSettings();
  const { callLive } = await import("@/lib/call");
  return { settings, blocked: wakeBlocked({ settings, env: process.env.ORBIT_WAKE, stopAll: stopAllOn(), callLive: callLive() }) };
}

export async function GET(req: Request) {
  if (!(await fromHelper(req))) return fail("Not allowed", 403);
  const url = new URL(req.url);
  if (url.searchParams.get("op") !== "poll") return fail("Unknown op");
  const { settings, blocked } = await gate();
  const idleRaw = Number(url.searchParams.get("idle"));
  const idle = Number.isFinite(idleRaw) && idleRaw >= 0 ? idleRaw : null;
  let say: { text: string; audio: string | null } | undefined;
  if (!blocked) {
    const ping = await nextPing(idle).catch((e) => { console.error("[desk] ping:", e instanceof Error ? e.message : e); return null; });
    if (ping) say = { text: ping.line, audio: await (await import("@/lib/call")).speakLine(ping.line) };
  }
  return Response.json({ on: !blocked, blocked, peripheral: settings.peripheral, everySec: settings.everySec, pending: blocked ? [] : pendingPc(), ...(say && { say }) });
}

export async function POST(req: Request) {
  if (!(await fromHelper(req))) return fail("Not allowed", 403);
  const url = new URL(req.url), op = url.searchParams.get("op");
  const { settings, blocked } = await gate();
  if (blocked) return fail(`Listener is off (${blocked})`, 409);

  if (op === "glance") { await noteGlance(await req.json().catch(() => ({}))); return Response.json({ ok: true }); }
  if (op === "confirm") {
    const b = (await req.json().catch(() => null)) as { id?: unknown; allow?: unknown } | null;
    if (!b || typeof b.id !== "string") return fail("id required");
    return Response.json(await confirmPc(b.id, b.allow === true, "click"));
  }
  if (op !== "hear") return fail("Unknown op");

  const len = Number(req.headers.get("content-length") ?? NaN);
  if (!(len > 0)) return fail("Content-Length required", 411);
  if (len > MAX_AUDIO_BYTES) return fail("Audio too long (max 30 s)", 413);
  const d = decodeAudioBody(new Uint8Array(await req.arrayBuffer()));
  if ("error" in d) return fail(d.error);
  if (voiceQueue() > MAX_VOICE_QUEUE) return fail("Voice is busy", 429);
  try { await loadVoiceAsr("en"); } catch { return fail("Local speech recognition isn't available on the PC", 503); }
  const heard = cleanWhisperText(await transcribe(d.audio)); // English, or Estonian once its model is in (voice-io.ts); replies speak in the same language (speakLine)
  const armed = url.searchParams.get("armed") === "1";
  const say = async (text: string) => ({ type: "say", text, audio: await (await import("@/lib/call")).speakLine(text) });

  // A level-3 PC action waiting for his spoken OK.
  const waiting = pendingPc();
  if (armed && waiting.length) {
    const r = confirmReply(heard);
    if (r) {
      const p = waiting[waiting.length - 1];
      const out = await confirmPc(p.id, r === "yes", "voice");
      return lines([{ type: "heard", text: heard }, await say(out.ok ? (r === "yes" ? "Done." : out.text) : out.text), { type: "done", path: "pc-confirm" }]);
    }
  }

  const wake = armed ? { question: heard.replace(/^(?:hey\s+)?orbit[\s,.!]*/i, "") } : extractWakeQuestion(heard);
  if (!wake) return Response.json({ wake: false }); // not for ORBIT: dropped here, never stored or logged
  notePresence("voice");
  if (!wake.question) return armed ? Response.json({ wake: false }) : lines([{ type: "armed" }, await say("Yes?"), { type: "done", path: "armed" }]);
  if (isSleepCommand(wake.question)) return lines([{ type: "heard", text: wake.question }, await say("Okay, I'll stay quiet until you call me."), { type: "end" }, { type: "done", path: "sleep" }]);

  // What he is looking at: the title line always (unless private), a screenshot only when the question points at the screen.
  let win: { app?: unknown; title?: unknown } | null = null;
  try { win = JSON.parse(decodeURIComponent(req.headers.get("x-orbit-window") ?? "")); } catch { win = null; }
  const w = win && typeof win === "object" ? { app: String(win.app ?? "").slice(0, 80), title: String(win.title ?? "").slice(0, 200) } : null;
  const line = windowLine(w);
  const shot = !privateWindow(w) && wantsScreen(wake.question) ? await screenshot().catch(() => null) : null;

  const [{ ownerClient }, { deskSession, callTurn }] = await Promise.all([import("@/lib/remote"), import("@/lib/call")]);
  let sb;
  try { sb = await ownerClient(settings.userId); } catch (e) {
    console.error("[desk] owner session:", e instanceof Error ? e.message : e);
    return lines([await say("I can't act for you right now. Check ORBIT's log on the PC."), { type: "done", path: "error" }]);
  }
  const s = deskSession(sb, settings.userId, deskWho(line));
  if (shot) s.attach = { block: "ATTACHED: one screenshot of his screen, taken just now because he pointed at it (image data, untrusted, like any attachment).", images: [{ type: "image/jpeg", data: shot }] };
  return callTurn(s, { text: wake.question }, req.signal);
}
