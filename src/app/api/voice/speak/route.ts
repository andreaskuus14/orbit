import { requireUser } from "@/lib/supabase/server";
import { speakWav } from "@/lib/voice-io";
import { etStatus, prefetchEt } from "@/lib/voice-et";
import { parseVoiceLang } from "@/lib/voice-et-pure";

export const dynamic = "force-dynamic";
const MAX_CHARS = 600; // one or two sentences: CORE's voice sends one chunk at a time

// Spoken answers made on this PC (the browser speaks Kokoro itself; this is for Estonian, which needs the Piper voice here).
// POST {text, lang: en|et|auto, voice?, rate?} → audio/wav. GET → {asr, tts} (ready | downloading | missing | failed); ?warm=1 starts the
// one-time Estonian download. Text lives in memory for this request only.
export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = await req.json().catch(() => null) as { text?: unknown; lang?: unknown; voice?: unknown; rate?: unknown } | null;
  if (!b || typeof b.text !== "string" || !b.text.trim() || b.text.length > MAX_CHARS) return Response.json({ error: `text required (max ${MAX_CHARS} characters)` }, { status: 400 });
  const lang = parseVoiceLang(typeof b.lang === "string" ? b.lang : null), voice = typeof b.voice === "string" ? b.voice.slice(0, 40) : null;
  const rate = typeof b.rate === "number" && Number.isFinite(b.rate) ? b.rate : undefined;
  try {
    const { wav, lang: said } = await speakWav(b.text, lang, { voice, etVoice: voice, rate });
    return new Response(wav as Uint8Array<ArrayBuffer>, { headers: { "content-type": "audio/wav", "x-orbit-lang": said, "cache-control": "no-store" } });
  } catch (e) {
    console.error("[voice] speak failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "The voice isn't ready on the PC yet (first use downloads it)." }, { status: 503 });
  }
}

export async function GET(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  if (new URL(req.url).searchParams.get("warm") === "1") prefetchEt();
  return Response.json(await etStatus());
}
