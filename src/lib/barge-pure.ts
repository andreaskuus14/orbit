// Voice barge-in: while ORBIT talks, mic energy clearly above ORBIT's own voice as the mic hears it (the echo guard)
// for BARGE_MS means the owner is talking over it, so speech stops. Per-frame and pure; tested in tests/barge-pure.test.ts.

export const BARGE_MS = 200; // the owner's voice this long over ORBIT stops it
export const ECHO_WARMUP_MS = 150; // first part of ORBIT's playback only teaches the echo level (never a barge)
export const ECHO_RATIO = 2; // louder than 2× ORBIT's learned echo = a person, not the speakers
export const MIN_VOICE = 0.015; // RMS below this is never a voice (room noise with echo cancellation working)

/** echo: ORBIT's voice level at the mic (slow average); playMs: how long ORBIT has been talking; louderMs: run of louder frames. */
export type Barge = { echo: number; playMs: number; louderMs: number };
export const BARGE_START: Barge = { echo: 0, playMs: 0, louderMs: 0 };

export function bargeStep(b: Barge, level: number, frameMs: number, orbitTalking: boolean): { b: Barge; barge: boolean } {
  if (!orbitTalking) return { b: BARGE_START, barge: false };
  const louder = b.playMs >= ECHO_WARMUP_MS && level > Math.max(MIN_VOICE, b.echo * ECHO_RATIO);
  const louderMs = louder ? b.louderMs + frameMs : 0;
  // Learn the echo only from frames that aren't the owner talking (else his voice would raise the bar against itself).
  const echo = louder ? b.echo : b.echo ? b.echo * 0.95 + level * 0.05 : level;
  return { b: { echo, playMs: b.playMs + frameMs, louderMs }, barge: louderMs >= BARGE_MS };
}
