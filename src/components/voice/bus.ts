"use client";
// Shared voice state between the mic (command bar), CORE's spoken answers and the 3D CORE.
// Plain mutable values read every frame by the galaxy — no React re-renders for audio levels.

import type { PanelId } from "@/lib/planets";

export const voiceLevel = { mic: 0, speak: 0 }; // 0..1, updated by the voice input / speech output
/** The open panel, kept current by Orbit, so the recognizer can prefer alternatives that are commands for this place. */
export const voiceContext: { current?: PanelId | null } = {};

/** handsFree: who listens for "Orbit…" — nobody, Chrome's recognizer (audio goes to Google while listening) or local
 *  Whisper on this PC. engine: who transcribes push-to-talk questions (forced to Whisper when hands-free is local). lang: Chrome's language. */
export type HandsFree = "off" | "chrome" | "local";
/** conversation: after "Orbit, let's talk", keep listening until told to stop ("stay") or for one follow-up only ("once"). */
export type VoiceSettings = { speak: boolean; handsFree: HandsFree; voiceURI: string | null; rate: number; lang: string; engine: "chrome" | "whisper"; conversation: "stay" | "once" };
export const DEFAULT_VOICE: VoiceSettings = { speak: true, handsFree: "chrome", voiceURI: null, rate: 1.05, lang: "en-US", engine: "chrome", conversation: "stay" }; // hands-free on: the user asked for it; Settings says Chrome streams audio while it listens

/** Stored settings (any version) → current shape. Old { wake: boolean }: on + Whisper meant "keep my audio local", so it
 *  becomes local hands-free; on + Chrome stays Chrome. */
export function migrateVoiceSettings(raw: unknown): VoiceSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const engine = o.engine === "whisper" ? "whisper" : "chrome";
  const handsFree: HandsFree = o.handsFree === "off" || o.handsFree === "chrome" || o.handsFree === "local" ? o.handsFree
    : o.wake === false ? "off" : o.wake === true ? (engine === "whisper" ? "local" : "chrome") : DEFAULT_VOICE.handsFree;
  return {
    speak: typeof o.speak === "boolean" ? o.speak : DEFAULT_VOICE.speak,
    handsFree, engine,
    voiceURI: typeof o.voiceURI === "string" ? o.voiceURI : null,
    rate: typeof o.rate === "number" && Number.isFinite(o.rate) ? o.rate : DEFAULT_VOICE.rate,
    lang: typeof o.lang === "string" && o.lang ? o.lang : DEFAULT_VOICE.lang,
    conversation: o.conversation === "once" ? "once" : "stay",
  };
}

/** The one place that decides which recognizer may be built. "local" hands-free never yields "chrome", for either use. */
export function recognizerFor(s: Pick<VoiceSettings, "handsFree" | "engine">, use: "handsFree" | "pushToTalk"): "chrome" | "whisper" | null {
  if (use === "handsFree") return s.handsFree === "off" ? null : s.handsFree === "local" ? "whisper" : "chrome";
  return s.handsFree === "local" || s.engine === "whisper" ? "whisper" : "chrome";
}

const KEY = "orbit.voice";
export function loadVoiceSettings(): VoiceSettings {
  try { return migrateVoiceSettings(JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { return DEFAULT_VOICE; }
}
export function saveVoiceSettings(s: VoiceSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: settings just don't persist */ }
  window.dispatchEvent(new CustomEvent("orbit:voice-settings", { detail: s }));
}

/** Fired by the voice input when the user finished speaking a question; Orbit sends it to CORE. */
export const VOICE_ASK = "orbit:voice-ask"; // detail: { text: string }
/** Fired when the user starts talking, so any answer being spoken stops (barge-in). */
export const VOICE_INTERRUPT = "orbit:voice-interrupt";
/** Start/stop conversation mode (the 💬 toggle). detail: { on: boolean } */
export const VOICE_CONVERSATION = "orbit:voice-conversation";
/** CorePanel finished (or failed/stopped) a spoken answer's stream. */
export const CORE_DONE = "orbit:core-done";
