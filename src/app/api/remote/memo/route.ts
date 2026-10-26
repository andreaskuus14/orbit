import { deviceFromCookie, ownerClient, rateOk, remoteProblem } from "@/lib/remote";
import { requireUser } from "@/lib/supabase/server";
import { ASR_RATE, decodeAudioBody } from "@/lib/audio-pure";
import { loadVoiceAsr, MAX_VOICE_QUEUE, transcribeSpeech, voiceQueue } from "@/lib/voice-asr";
import { cleanWhisperText } from "@/components/voice/hear";
import { MAX_MEMO_CHARS, MAX_MEMO_SEC } from "@/lib/memos-pure";
import { fileMemo, listMemos, refileMemo, undoMemo } from "@/lib/memos";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Voice memos, for the paired phone (device cookie) or the PC (signed-in session). GET → {memos}.
// POST ?op=file[&keep=1] with a 16 kHz mono WAV (≤ 2 min) → transcribe locally → classify → file → {memo}.
// POST ?op=refile {id, kind} / ?op=undo {id} → {memo}. The audio is decoded in memory and dropped after transcription,
// unless keep=1 (then it's saved next to memos.json on the PC). Nothing is sent outward.
const fail = (error: string, status = 400) => Response.json({ error }, { status });
const RATE = { limit: 20, windowMs: 60_000 };
const MAX_BYTES = MAX_MEMO_SEC * ASR_RATE * 4 + 1024;

async function caller() {
  const device = remoteProblem() ? null : await deviceFromCookie();
  if (device) {
    if (!rateOk(`memo:${device.id}`, RATE)) return { res: fail("Too many memos: wait a minute", 429) };
    try { return { sb: await ownerClient(device.userId), userId: device.userId, source: "phone" as const }; } catch (e) {
      console.error("[memo] owner session:", e instanceof Error ? e.message : e);
      return { res: fail("The PC can't act for you right now: check ORBIT's log on the PC", 503) };
    }
  }
  const u = await requireUser();
  if (u.res) return { res: u.res };
  if (!rateOk("memo:pc", RATE)) return { res: fail("Too many memos: wait a minute", 429) };
  return { sb: u.sb, userId: u.user.id, source: "pc" as const };
}

export async function GET() {
  const c = await caller();
  if (!c.sb) return c.res;
  return Response.json({ memos: await listMemos() });
}

export async function POST(req: Request) {
  const c = await caller();
  if (!c.sb) return c.res;
  const url = new URL(req.url), op = url.searchParams.get("op");
  try {
    if (op === "refile" || op === "undo") {
      const body = await req.json().catch(() => null) as { id?: unknown; kind?: unknown } | null;
      if (!body || typeof body.id !== "string") return fail("id required");
      const r = op === "undo" ? await undoMemo(c.sb, c.userId, body.id) : await refileMemo(c.sb, c.userId, body.id, body.kind);
      return typeof r === "string" ? fail(r, 409) : Response.json({ memo: r });
    }
    if (op !== "file") return fail("Unknown op");
    const len = Number(req.headers.get("content-length") ?? NaN);
    if (!(len > 0)) return fail("Content-Length required", 411);
    if (len > MAX_BYTES) return fail(`Memo too long (max ${MAX_MEMO_SEC / 60} min)`, 413);
    const wav = new Uint8Array(await req.arrayBuffer());
    if (wav.length > MAX_BYTES) return fail(`Memo too long (max ${MAX_MEMO_SEC / 60} min)`, 413);
    const d = decodeAudioBody(wav, MAX_MEMO_SEC);
    if ("error" in d) return fail(d.error);
    if (voiceQueue() > MAX_VOICE_QUEUE) return fail("Voice is busy: try again in a moment", 429);
    try { await loadVoiceAsr("en"); } catch (e) {
      console.error("[memo] whisper load failed:", e instanceof Error ? e.message : e);
      return fail("Local Whisper isn't available on the PC", 503);
    }
    const text = cleanWhisperText(await transcribeSpeech(d.audio, "en")).trim().slice(0, MAX_MEMO_CHARS);
    if (!text) return fail("Didn't catch any words: try again closer to the mic", 422);
    return Response.json({ memo: await fileMemo(c.sb, c.userId, text, c.source, url.searchParams.get("keep") === "1" ? wav : undefined) });
  } catch (e) {
    console.error(`[memo] ${op}:`, e instanceof Error ? e.message : e);
    return fail("Something went wrong on the PC: check ORBIT there", 500);
  }
}
