// Post-processing warm-up (see WarmCompile): per composer, the passes it was warmed for and how long frames may be skipped.
export type WarmState<P> = { passes: readonly P[]; ready: boolean; until: number };

/** A warm-up is due on the first frame and whenever the composer's passes change (added, removed, rebuilt). */
export function passesChanged<P>(w: WarmState<P> | undefined, passes: readonly P[]): boolean {
  return !w || w.passes.length !== passes.length || w.passes.some((p, i) => p !== passes[i]);
}

/** Skip drawing while the shaders compile, but never past the deadline: a stuck compile must not blank the world. */
export function skipFrame(w: WarmState<unknown>, now: number): boolean {
  return !w.ready && now < w.until;
}
