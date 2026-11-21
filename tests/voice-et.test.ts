import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createPool } from "../src/lib/asr-pool.ts";
import { asrPlan, clauses, cleanEspeak, ET_ASR, ET_BYTES, ET_TTS, etSpeaker, guessLang, hfUrl, lengthScale, parseVoiceLang, piperIds, ttsLang, zipformerConfig } from "../src/lib/voice-et-pure.ts";

const LIB = path.join(import.meta.dirname, "..", "src", "lib");
const j = (...p: string[]) => p.join("/");

test("guessLang: Estonian and English sentences, short replies, ties", () => {
  for (const t of ["Tere! Mis kell on?", "Pane meelde, et homme on kohtumine.", "Kas sa saatsid selle ära?", "aitäh", "jah", "Ma ei tea.", "Õues sajab vihma."])
    assert.equal(guessLang(t), "et", t);
  for (const t of ["What's the weather tomorrow?", "Open the calendar please", "Thanks, that is all.", "Remind me to call mom", "yes"])
    assert.equal(guessLang(t), "en", t);
  for (const t of ["", "ORBIT", "on", "Spotify"]) assert.equal(guessLang(t), "unknown", t);
  // An English word inside an Estonian sentence (the owner does this) stays Estonian.
  assert.equal(guessLang("Tee mulle uus YouTube Shorts video ja pane see kalendrisse"), "et");
});

test("asrPlan: the Estonian model only once it's ready; auto checks the first transcript", () => {
  assert.equal(asrPlan("et", false), "en");
  assert.equal(asrPlan("et", true), "et");
  assert.equal(asrPlan("auto", true), "en-then-check");
  assert.equal(asrPlan("auto", false), "en");
  assert.equal(asrPlan("en", true), "en");
  assert.equal(parseVoiceLang("et"), "et"); assert.equal(parseVoiceLang("auto"), "auto"); assert.equal(parseVoiceLang("xx"), "en"); assert.equal(parseVoiceLang(null), "en");
});

test("ttsLang: fixed languages stay; auto goes by the reply's words, unknown → English", () => {
  assert.equal(ttsLang("et", "Hello"), "et");
  assert.equal(ttsLang("en", "Tere"), "en");
  assert.equal(ttsLang("auto", "Homme on sul kolm kohtumist."), "et");
  assert.equal(ttsLang("auto", "You have three meetings tomorrow."), "en");
  assert.equal(ttsLang("auto", "OK"), "en");
});

test("clauses keep their punctuation for Piper's pauses", () => {
  assert.deepEqual(clauses("Tere! Mina olen ORBIT, sinu abiline."), [{ text: "Tere", punct: "!" }, { text: "Mina olen ORBIT", punct: "," }, { text: "sinu abiline", punct: "." }]);
  assert.deepEqual(clauses("  Ilma punktita lause  "), [{ text: "Ilma punktita lause", punct: "" }]);
  assert.deepEqual(clauses("Oota… nüüd?"), [{ text: "Oota", punct: "." }, { text: "nüüd", punct: "?" }]);
  assert.deepEqual(clauses("?!"), []);
});

test("cleanEspeak: echogarden's '_' separators and ' | ' clause marks → Piper's plain IPA", () => {
  assert.equal(cleanEspeak("t_ˈe_r_ɛ | m_ˌi_n_ɑ ˌo_l_ɛ_n"), "tˈerɛ mˌinɑ ˌolɛn");
  assert.equal(cleanEspeak("k_ˈo_l_m__ j_a"), "kˈolm ja");
});

test("piperIds: ^ _ p _ … $, unknown symbols skipped, against the real et_EE voice map", () => {
  const map: Record<string, number[]> = { _: [0], "^": [1], $: [2], " ": [3], "!": [4], t: [10], e: [11], r: [12], "ˈ": [13] };
  assert.deepEqual(piperIds([{ ipa: "tˈer", punct: "!" }], map), [1, 0, 10, 0, 13, 0, 11, 0, 12, 0, 4, 0, 2]);
  assert.deepEqual(piperIds([{ ipa: "tx", punct: "" }, { ipa: "e", punct: "" }], map), [1, 0, 10, 0, 3, 0, 11, 0, 2]);
});

test("the TTS worker's own id code matches piperIds (the worker can't import TS)", () => {
  const src = readFileSync(path.join(LIB, "voice-et-tts-worker.mjs"), "utf8");
  const body = src.slice(src.indexOf("function pipeIds"), src.indexOf("process.on(\"disconnect\""));
  const pipeIds = new Function(`${body}; return pipeIds;`)() as typeof piperIds;
  const map: Record<string, number[]> = { _: [0], "^": [1], $: [2], " ": [3], ",": [5], a: [20], "ː": [21], "ɵ": [22] };
  const ph = [{ ipa: "aːɵ", punct: "," }, { ipa: "ɵa", punct: "" }];
  assert.deepEqual(pipeIds(ph, map), piperIds(ph, map));
});

test("pinned models: revisions, hashes and sizes, MIT, small enough for 8 GB", () => {
  for (const f of [...ET_ASR.files, ...ET_TTS.files]) { assert.match(f.sha256, /^[0-9a-f]{64}$/); assert.ok(f.bytes > 0); }
  assert.match(ET_ASR.rev, /^[0-9a-f]{40}$/); assert.match(ET_TTS.rev, /^[0-9a-f]{40}$/);
  assert.equal(ET_ASR.license, "MIT");
  assert.ok(ET_BYTES < 300e6, `${ET_BYTES}`);
  assert.equal(hfUrl(ET_TTS.repo, ET_TTS.rev, ET_TTS.base + ET_TTS.model), `https://huggingface.co/rhasspy/piper-voices/resolve/${ET_TTS.rev}/et/et_EE/news/medium/et_EE-news-medium.onnx`);
});

test("zipformerConfig, speakers, speed", () => {
  const c = zipformerConfig("/m/z", 32, j);
  assert.equal(c.modelConfig.transducer.encoder, "/m/z/encoder.int8.onnx");
  assert.equal(c.modelConfig.numThreads, 8);
  assert.equal(zipformerConfig("/m", 0, j).modelConfig.numThreads, 1);
  assert.equal(etSpeaker("Albert"), 0); assert.equal(etSpeaker("Mari"), 2); assert.equal(etSpeaker("nobody"), 2); assert.equal(etSpeaker(null), 2);
  assert.equal(lengthScale(1), 1); assert.ok(lengthScale(1.25) < 1); assert.equal(lengthScale(99), 1 / 1.4); assert.equal(lengthScale(undefined), 1);
});

test("both Estonian workers survive a missing model (a rejection, never a server crash)", async () => {
  const asr = createPool(path.join(LIB, "voice-et-asr-worker.mjs"), 1, 30_000, "Estonian ASR");
  await assert.rejects(asr.run({ config: zipformerConfig(path.join(import.meta.dirname, "no-such-model"), 1, path.join) }, 60_000));
  asr.close();
  const tts = createPool(path.join(LIB, "voice-et-tts-worker.mjs"), 1, 30_000, "Estonian voice");
  await assert.rejects(tts.run({ dir: path.join(import.meta.dirname, "no-such-model"), model: ET_TTS.model, json: `${ET_TTS.model}.json` }, 60_000));
  tts.close();
});
