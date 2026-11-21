// Estonian voice, both ways, on this PC (runner: voice-et.ts, child process: voice-et-worker.mjs). Pure parts, tested in tests/voice-et.test.ts.
// Listening: TalTech's Zipformer for Estonian (MIT, sherpa-onnx, int8 ~156 MB). Trained on ~1300 h of hand-transcribed Estonian, ~3000 h of
//   Estonian TV and ~500 h of English podcasts, so English words inside Estonian sentences come out right. Punctuated.
// Speaking: Piper's et_EE "news" voice (rhasspy/piper-voices, MIT; data: TartuNLP's Estonian news sentences corpus, CC-BY; 4 speakers,
//   ~77 MB), run with onnxruntime-node; Estonian phonemes from espeak-ng (@echogarden/espeak-ng-emscripten, GPL-3.0, WebAssembly). Not XTTS (Coqui CPML, non-commercial),
//   not MMS (CC-BY-NC), not TartuNLP's FastPitch (CC-BY-NC-SA).
// English stays as it is: Parakeet / Whisper in, Kokoro out.

export type VoiceLang = "en" | "et" | "auto";
export const parseVoiceLang = (q: string | null | undefined): VoiceLang => (q === "et" || q === "auto" ? q : "en");

type Pinned = { name: string; sha256: string; bytes: number };
const HF = "https://huggingface.co";
export const hfUrl = (repo: string, rev: string, file: string) => `${HF}/${repo}/resolve/${rev}/${file.split("/").map(encodeURIComponent).join("/")}`;

export const ET_ASR = {
  dir: "et-zipformer-large",
  repo: "TalTechNLP/streaming-zipformer-large.et-en",
  rev: "2812262bd4fd5d4327dc09ca0e6c19e8a32a03d6",
  files: [
    { name: "encoder.int8.onnx", sha256: "4249db3c9a9a66dc368b169cccb39088fe2f4d3f62d19907f110daea8a2d387f", bytes: 154_895_904 },
    { name: "decoder.int8.onnx", sha256: "75293b68a6a391f926e9c8a62680c447ba9a97e885aef7dcba0cbfa5433a6198", bytes: 796_689 },
    { name: "joiner.int8.onnx", sha256: "cfa4a072813c4ae140d3604eb16f875fd13f5bbcedb32a673815dc12fa17521b", bytes: 517_416 },
    { name: "tokens.txt", sha256: "cbe23ea2ef76303d874ab45ef8471b570e565b9048ab0aeda1c7adf2c663ee97", bytes: 11_493 },
  ] as Pinned[],
  license: "MIT",
} as const;

export const ET_TTS = {
  dir: "et-piper-news",
  repo: "rhasspy/piper-voices",
  rev: "e9c8a39444359388adaa94255becb37a5a2b8e51",
  base: "et/et_EE/news/medium/",
  model: "et_EE-news-medium.onnx",
  files: [
    { name: "et_EE-news-medium.onnx", sha256: "e4a55ec42364c5a2d060bf51ef7525b141b24cd56426f61a3702b44f68f5f21f", bytes: 76_757_937 },
    { name: "et_EE-news-medium.onnx.json", sha256: "281235a43df750a5ca3edc0c752a74c3487e63609c53468a7fce1d4b93d161af", bytes: 6_353 },
  ] as Pinned[],
  speakers: { Albert: 0, Kalev: 1, Mari: 2, Vesta: 3 } as Record<string, number>,
  license: "MIT (voice); training data CC-BY (TartuNLP)",
} as const;

/** Both models together, for "downloads ~240 MB once" text. */
export const ET_BYTES = [...ET_ASR.files, ...ET_TTS.files].reduce((n, f) => n + f.bytes, 0);

/** Text → clauses with their closing punctuation (Piper keeps , . ! ? ; : between clauses; it shapes the pauses and the tune). */
export function clauses(text: string): { text: string; punct: string }[] {
  const out: { text: string; punct: string }[] = [];
  for (const m of text.replace(/\s+/g, " ").matchAll(/([^,.!?;:…]+)([,.!?;:…]*)/g)) {
    const t = m[1].trim();
    if (!t) { if (out.length && m[2]) out[out.length - 1].punct ||= m[2][0]; continue; }
    out.push({ text: t, punct: (m[2] || "")[0] === "…" ? "." : (m[2] || "")[0] ?? "" });
  }
  return out;
}

/** espeak-ng's phoneme string (echogarden build: "_" between phonemes, " | " at its own clause breaks) → Piper's form. */
export const cleanEspeak = (s: string) => s.replace(/_/g, "").replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim();

/** One clause list → Piper input ids: ^ _ p _ p _ … $ (BOS, a pad after every symbol, EOS), unknown symbols skipped. */
export function piperIds(phonemes: { ipa: string; punct: string }[], map: Record<string, number[]>): number[] {
  const id = (c: string) => map[c]?.[0];
  const pad = id("_") ?? 0, ids = [id("^") ?? 1, pad];
  const text = phonemes.map((p) => p.ipa + p.punct).filter(Boolean).join(" ");
  for (const c of Array.from(text.normalize("NFD"))) { const i = id(c); if (i !== undefined) ids.push(i, pad); }
  ids.push(id("$") ?? 2);
  return ids;
}

const threadsOf = (n: number) => Math.max(1, Math.min(8, n));
/** Recognizer config for the worker: the streaming Zipformer, fed one whole utterance. */
export function zipformerConfig(dir: string, threads: number, join: (...p: string[]) => string) {
  const f = (n: string) => join(dir, n);
  return {
    kind: "asr" as const,
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: { transducer: { encoder: f("encoder.int8.onnx"), decoder: f("decoder.int8.onnx"), joiner: f("joiner.int8.onnx") }, tokens: f("tokens.txt"),
      numThreads: threadsOf(threads), provider: "cpu", debug: 0 },
    decodingMethod: "modified_beam_search", maxActivePaths: 4, enableEndpoint: 0,
  };
}

/** Speaker id for a voice name ("Mari"), else Mari (the clearest of the four to the owner's ear is his call: Settings → Voice). */
export const etSpeaker = (name: string | null | undefined) => ET_TTS.speakers[name ?? ""] ?? ET_TTS.speakers.Mari;
/** Speed setting (0.8..1.4×) → Piper length scale (bigger = slower). */
export const lengthScale = (rate: number | undefined) => 1 / Math.min(1.4, Math.max(0.8, Number(rate) || 1));

// ---- Language ID from text: which language is this transcript / reply in? ----
// Estonian has õ (no other common language here does) and ä/ö/ü; plus very common short words. Words common in both are ignored.
const ET_COMMON = new Set(("ja ei ole olen oled oli olid mis kas ma sa ta me te nad mina sina tema meie teie nemad mul sul tal kui aga ka veel nüüd siis seda " +
  "selle see seal siin tere aitäh palun jah jaa nii väga hea kõik mitte või ning mida miks kus kuidas millal üks kaks kolm täna homme eile " +
  "kell tund minut päev nädal ilm mulle sulle talle tee pane ava näita räägi ütle meelde tuleta kirjuta saada loe vaata leia").split(" "));
const EN_COMMON = new Set(("the a an and or but to of in at for with is are was were be been it this that i you he she they my your not no do did have has what " +
  "so just like yeah oh go get got can will if there here all up out please thanks thank yes open show tell write send read find remind " +
  "today tomorrow yesterday time weather would could should about from how why where when which who").split(" "));

/** "et" / "en" from the words alone; "unknown" when it's too short or a tie (then the caller keeps its first guess). */
export function guessLang(text: string): "et" | "en" | "unknown" {
  const ws = text.toLowerCase().normalize("NFC").split(/[^\p{L}']+/u).filter(Boolean).slice(0, 200);
  if (!ws.length) return "unknown";
  let et = 0, en = 0;
  for (const w of ws) {
    const inEt = ET_COMMON.has(w), inEn = EN_COMMON.has(w);
    if (/õ/.test(w)) et += 2;
    else if (/[äöü]/.test(w)) et += 1;
    else if (inEt && !inEn) et += 1;
    else if (inEn && !inEt) en += 1;
  }
  if (et === en) return "unknown";
  return et > en ? "et" : "en";
}

/** Which recognizer listens. "et" → the Estonian model; "en" → the English path (Parakeet / Whisper); "auto" → the English path first,
 *  then the Estonian model when that transcript reads as Estonian (`firstGuess`). `etReady` = the Estonian model is on disk and loads. */
export function asrPlan(lang: VoiceLang, etReady: boolean): "et" | "en" | "en-then-check" {
  if (!etReady) return "en";
  if (lang === "et") return "et";
  return lang === "auto" ? "en-then-check" : "en";
}

/** Which voice says a reply. "auto" goes by the words of the reply itself; unknown stays English (Kokoro). */
export function ttsLang(lang: VoiceLang, text: string): "en" | "et" {
  if (lang !== "auto") return lang;
  return guessLang(text) === "et" ? "et" : "en";
}
