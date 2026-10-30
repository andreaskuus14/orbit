// Audio priority policy (roadmap G13+G14): voice/mic > media (THEATER) > completion/attention cues > ambience.
// Pure: state → target gain multipliers, which spoken lines wait, and which events earn a completion cue.
// The engine (components/audio-policy.ts) applies these with smooth ramps. Tested in tests/audio-policy.test.ts.
export const MUTE_KEY = "orbit.mute"; // "1" = global mute: every ORBIT sound, on top of the separate volume/off controls
export const DUCK = 0.2; // ambience and UI cues while he talks or ORBIT speaks
export const CUE_UNDER_MEDIA = 0.5; // cues stay audible but quieter under a playing video
export const RAMP_S = 0.12; // setTargetAtTime constant: ~0.4 s to settle, no clicks

export type AudioState = { mic: boolean; speaking: boolean; media: boolean; muted: boolean };
export const AUDIO_IDLE: AudioState = { mic: false, speaking: false, media: false, muted: false };

/** Multipliers (0..1) applied on top of each layer's own volume. */
export function targetGains(s: AudioState): { ambience: number; cues: number } {
  if (s.muted) return { ambience: 0, cues: 0 };
  const voice = s.mic || s.speaking;
  return {
    ambience: s.media ? 0 : voice ? DUCK : 1,
    cues: voice ? DUCK : s.media ? CUE_UNDER_MEDIA : 1,
  };
}

/** A non-urgent spoken announcement waits while a video plays (or everything is muted); urgent ones go now. */
export const holdAnnouncement = (s: AudioState, urgent: boolean) => !urgent && (s.media || s.muted);

/** Completion cue only for a persisted, verified completion: the task row saved as "done" (agents.ts emits after save).
 *  Model text never reaches here; awaiting approval, failed or cancelled stay silent. */
export const verifiedCompletion = (type: string, payload?: { status?: unknown } | null) =>
  type === "agent.completed" && payload?.status === "done";
