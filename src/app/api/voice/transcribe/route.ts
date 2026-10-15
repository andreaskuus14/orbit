import { requireUser } from "@/lib/supabase/server";
import { decodeAudioBody, MAX_AUDIO_BYTES } from "@/lib/audio-pure";
import { loadVoiceAsr, transcribeSpeech } from "@/lib/voice-asr";

export const dynamic = "force-dynamic";

// Local Whisper for voice input. Body: 16 kHz mono audio (raw Float32 LE or WAV), ≤ 30 s → { text }.
// The audio lives in memory for this request only; it is never written anywhere.
export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const tooLong = Response.json({ error: "Audio too long (max 30 s)" }, { status: 413 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES) return tooLong;
  const body = await readCapped(req, MAX_AUDIO_BYTES);
  if (!body) return tooLong;
  const d = decodeAudioBody(body);
  if ("error" in d) return Response.json({ error: d.error }, { status: 400 });
  try { await loadVoiceAsr(); } catch (e) {
    console.error("voice model load failed", e);
    return Response.json({ error: "Local Whisper isn't available (model download or load failed). Switch voice settings to Chrome, or check the server log." }, { status: 503 });
  }
  try {
    return Response.json({ text: await transcribeSpeech(d.audio) });
  } catch (e) {
    console.error("voice transcribe failed", e);
    return Response.json({ error: "Transcription failed; try again." }, { status: 500 });
  }
}

/** Loads the model ahead of the first question (the voice settings call this when Local Whisper is chosen). */
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  try { await loadVoiceAsr(); return Response.json({ ready: true }); }
  catch { return Response.json({ ready: false }, { status: 503 }); }
}

async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  const r = req.body?.getReader();
  if (!r) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done || !value) break;
    n += value.length;
    if (n > max) { void r.cancel(); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
