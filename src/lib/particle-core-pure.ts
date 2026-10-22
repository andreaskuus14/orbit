// CORE's particle body: which shape the swarm is pulled toward, and how fast it changes shape.
// Weights are [idle sphere, voice waveform, busy ring]; the shader blends the three attractors with them.

export type CoreWeights = [number, number, number];
export type CoreState = { w: CoreWeights; hold: number; red: number };
export type CoreInput = { busy: boolean; mic: number; speak: number; warning: boolean };

export const BLEND_RATE = 3; // 1 - e^-3 = 95% of the way to a new shape in 1 s
export const VOICE_ON = 0.04; // voice level that counts as someone talking
export const VOICE_HOLD = 0.8; // s the waveform stays up through a pause between words

const unit = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** Simulation texture side per quality level (particles = side²): none below high, 16k at high, 37k at high + DOF. */
export const coreParticleSide = (level: number) => (level >= 3 ? 192 : level >= 2 ? 128 : 0);

export const newCoreState = (): CoreState => ({ w: [1, 0, 0], hold: 0, red: 0 });

/** Advance one frame. Busy beats voice beats idle; weights always finite, >= 0 and summing to 1.
 *  Writes into `out` (may be `s` itself) so the render loop allocates nothing. */
export function stepCore(s: CoreState, inp: CoreInput, dt: number, out: CoreState = newCoreState()): CoreState {
  const step = Number.isFinite(dt) ? Math.min(0.25, Math.max(0, dt)) : 0;
  const loud = Math.max(unit(inp.mic), unit(inp.speak)) > VOICE_ON;
  const hold = loud ? VOICE_HOLD : Math.max(0, (Number.isFinite(s.hold) ? s.hold : 0) - step);
  const mode = inp.busy ? 2 : hold > 0 ? 1 : 0;
  const k = 1 - Math.exp(-BLEND_RATE * step);
  const a = unit(s.w[0]), b = unit(s.w[1]), c = unit(s.w[2]);
  const w0 = a + ((mode === 0 ? 1 : 0) - a) * k, w1 = b + ((mode === 1 ? 1 : 0) - b) * k, w2 = c + ((mode === 2 ? 1 : 0) - c) * k;
  const sum = w0 + w1 + w2;
  if (sum > 1e-6) { out.w[0] = w0 / sum; out.w[1] = w1 / sum; out.w[2] = w2 / sum; }
  else { out.w[0] = mode === 0 ? 1 : 0; out.w[1] = mode === 1 ? 1 : 0; out.w[2] = mode === 2 ? 1 : 0; }
  const red = unit(s.red);
  out.red = red + ((inp.warning ? 1 : 0) - red) * k;
  out.hold = hold;
  return out;
}

/** Waveform height for a voice level: a small ripple at silence, up to ~1.6 units at full volume. */
export const waveAmp = (mic: number, speak: number) => 0.15 + 1.45 * Math.max(unit(mic), unit(speak));
