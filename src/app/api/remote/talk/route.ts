import { deviceFromCookie, ownerClient, rateOk, remoteProblem } from "@/lib/remote";
import { requireUser } from "@/lib/supabase/server";
import { decodeAudioBody, MAX_AUDIO_BYTES } from "@/lib/audio-pure";
import { loadVoiceAsr, MAX_VOICE_QUEUE, voiceQueue } from "@/lib/voice-asr";
import { callSettings, callTurn, endCall, getCall, ringing, setCheckin, startCall } from "@/lib/call";
import { validCheckin } from "@/lib/call-pure";
import { MAX_ASK_CHARS } from "@/lib/remote-pure";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// "ORBIT wants to talk": the call screen's endpoint, for the paired phone (device cookie) or the PC (signed-in session).
// GET → {ringing, checkin}. POST ?op=start → {id, reason, say:[{text,audio}]}; ?op=turn&call=<id> with a 16 kHz mono WAV (or
// JSON {text} from on-device speech recognition) → NDJSON (call.ts callTurn); ?op=end&call=<id>; ?op=settings {checkin:"HH:MM"|""}.
// Audio is decoded in memory for this request only and never written anywhere.
const fail = (error: string, status = 400, extra: object = {}) => Response.json({ error, ...extra }, { status });
const RATE = { limit: 60, windowMs: 60_000 };

async function caller() {
  const device = remoteProblem() ? null : await deviceFromCookie();
  if (device) {
    if (!rateOk(`talk:${device.id}`, RATE)) return { res: fail("Too many requests: wait a minute", 429) };
    try { return { sb: await ownerClient(device.userId), userId: device.userId }; } catch (e) {
      console.error("[call] owner session:", e instanceof Error ? e.message : e);
      return { res: fail("The PC can't act for you right now: check ORBIT's log on the PC", 503) };
    }
  }
  const u = await requireUser();
  if (u.res) return { res: u.res };
  if (!rateOk("talk:pc", RATE)) return { res: fail("Too many requests: wait a minute", 429) };
  return { sb: u.sb, userId: u.user.id };
}

export async function GET() {
  const c = await caller();
  if (!c.sb) return c.res;
  return Response.json({ ringing: ringing(), ...(await callSettings()) });
}

export async function POST(req: Request) {
  const c = await caller();
  if (!c.sb) return c.res;
  const url = new URL(req.url), op = url.searchParams.get("op");
  try {
    if (op === "start") return Response.json(await startCall(c.sb, c.userId));
    if (op === "settings") {
      const body = await req.json().catch(() => null) as { checkin?: unknown } | null;
      if (!body || !validCheckin(body.checkin)) return fail("checkin must be HH:MM or empty");
      return Response.json({ checkin: (await setCheckin(body.checkin)).checkin });
    }
    const call = getCall(c.userId, url.searchParams.get("call") ?? "");
    if (!call) return fail("That call has ended", 404);
    if (op === "end") return Response.json(await endCall(c.userId, call.id));
    if (op !== "turn") return fail("Unknown op");

    if ((req.headers.get("content-type") ?? "").startsWith("application/json")) {
      const body = await req.json().catch(() => null) as { text?: unknown } | null;
      if (!body || typeof body.text !== "string" || body.text.length > MAX_ASK_CHARS) return fail("text required");
      return callTurn(call, { text: body.text }, req.signal);
    }
    const len = Number(req.headers.get("content-length") ?? NaN); // the call screen always sends a sized body
    if (!(len > 0)) return fail("Content-Length required", 411);
    if (len > MAX_AUDIO_BYTES) return fail("Audio too long (max 30 s)", 413);
    const d = decodeAudioBody(new Uint8Array(await req.arrayBuffer()));
    if ("error" in d) return fail(d.error);
    if (voiceQueue() > MAX_VOICE_QUEUE) return fail("Voice is busy; say that again?", 429);
    try { await loadVoiceAsr("en"); } catch (e) {
      console.error("[call] whisper load failed:", e instanceof Error ? e.message : e);
      return fail("Local Whisper isn't available on the PC", 503, { fallback: "speech" }); // the call screen switches to on-device recognition
    }
    return callTurn(call, { audio: d.audio }, req.signal);
  } catch (e) {
    console.error(`[call] ${op}:`, e instanceof Error ? e.message : e);
    return fail("Something went wrong on the PC: check ORBIT there", 500);
  }
}
