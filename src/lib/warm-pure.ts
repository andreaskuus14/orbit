// Post-processing warm-up (see WarmCompile): per composer, the passes it was warmed for and how long frames may be skipped.
export type WarmState<P> = { passes: readonly P[]; ready: boolean; until: number; done?: Promise<unknown> | null };

/** A warm-up is due on the first frame and whenever the composer's passes change (added, removed, rebuilt). */
export function passesChanged<P>(w: WarmState<P> | undefined, passes: readonly P[]): boolean {
  return !w || w.passes.length !== passes.length || w.passes.some((p, i) => p !== passes[i]);
}

/** Skip drawing while the shaders compile, but never past the deadline: a stuck compile must not blank the world. */
export function skipFrame(w: WarmState<unknown>, now: number): boolean {
  return !w.ready && now < w.until;
}

/** The `n` slowest entries, slowest first. */
export function slowest<T extends { ms: number }>(list: readonly T[], n: number): T[] {
  return [...list].sort((a, b) => b.ms - a.ms).slice(0, n);
}

/** A short name for a compiled program in the perf log: three's shader (or the material's name), ORBIT's variant defines,
 *  and the first custom uniforms, which identify a ShaderMaterial (e.g. "physical+ORBIT_LITE(uRim,uRimColor,uLq)"). */
export function programLabel(name: string, cacheKey: string, fragment: string): string {
  const id = /^[a-z]+(?=,)/.exec(cacheKey)?.[0];
  const base = name || (id === "physical" && !cacheKey.includes(",PHYSICAL,") ? "standard" : id) || "shader"; // three's id for both
  const flags = [...new Set(cacheKey.match(/ORBIT_[A-Z]+/g) ?? [])];
  const us: string[] = [];
  for (const m of fragment.matchAll(/uniform\s+\w+\s+(u[A-Z]\w*)/g)) if (!us.includes(m[1]) && us.push(m[1]) >= 3) break;
  return ([base, ...flags].join("+") + (us.length ? `(${us.join(",")})` : "")).slice(0, 80);
}

/** A stand-in's opacity `ms` into its crossfade of `fade` ms: 1 → 0, eased at both ends (no pop as it starts or ends). */
export function standInAlpha(ms: number, fade: number): number {
  const t = Math.min(1, Math.max(0, fade > 0 ? ms / fade : 1));
  return 1 - t * t * (3 - 2 * t);
}
