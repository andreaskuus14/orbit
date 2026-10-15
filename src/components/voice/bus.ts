"use client";
// Shared voice state between the mic (command bar), CORE's spoken answers and the 3D CORE.
// Plain mutable values read every frame by the galaxy — no React re-renders for audio levels.

export const voiceLevel = { mic: 0, speak: 0 }; // 0..1, updated by the voice input / speech output

export type VoiceSettings = { speak: boolean; wake: boolean; voiceURI: string | null; rate: number };
export const DEFAULT_VOICE: VoiceSettings = { speak: true, wake: false, voiceURI: null, rate: 1.05 };

const KEY = "orbit.voice";
export function loadVoiceSettings(): VoiceSettings {
  try { return { ...DEFAULT_VOICE, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return DEFAULT_VOICE; }
}
export function saveVoiceSettings(s: VoiceSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: settings just don't persist */ }
  window.dispatchEvent(new CustomEvent("orbit:voice-settings", { detail: s }));
}

/** Fired by the voice input when the user finished speaking a question; Orbit sends it to CORE. */
export const VOICE_ASK = "orbit:voice-ask"; // detail: { text: string }
/** Fired when the user starts talking, so any answer being spoken stops (barge-in). */
export const VOICE_INTERRUPT = "orbit:voice-interrupt";
