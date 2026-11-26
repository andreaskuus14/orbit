// Realism pass for the planet worlds (v4): which tier a quality preset gets, what each tier costs, and how a plain
// MeshStandardMaterial is read as a real surface (stone, brushed metal, foliage, smooth) for the shader-noise patch.
// Tier 0 = low preset = the v3 look unchanged.

export type WorldTier = 0 | 1 | 2;

/** low preset (no bloom) -> 0; medium -> 1; high (MSAA on) -> 2. */
export const worldTier = (bloom: number, msaa: number): WorldTier => (!(bloom > 0) ? 0 : msaa > 0 ? 2 : 1);

/** What each tier turns on. env = procedural PMREM sky; shadow = key-light shadow map size (0 = none);
 *  glass = real transmission on crystals (one extra opaque pass); dust = mote count multiplier; seg = geometry detail step. */
export const REALISM = [
  { env: false, shadow: 0, glass: false, dust: 1, seg: 0, fog: 0 },
  { env: true, shadow: 1024, glass: false, dust: 1.4, seg: 1, fog: 0.012 },
  { env: true, shadow: 2048, glass: true, dust: 1.8, seg: 2, fog: 0.016 },
] as const;

/** Shader-noise surface: bump = normal strength, freq = noise scale (per world unit), rough = roughness wobble,
 *  vary = albedo variation, streak = brushed-metal grain (0..1). */
export type Surface = { bump: number; freq: number; rough: number; vary: number; streak: number };
export type SurfaceIn = { metalness: number; roughness: number; transparent?: boolean; wireframe?: boolean; foliage?: boolean };

/** Reads a material's numbers as a kind of surface. null = leave it alone (glass, wireframe holograms). */
export function surfaceFor(m: SurfaceIn, override?: Partial<Surface> | null): Surface | null {
  if (override === null || m.wireframe || m.transparent) return null;
  let s: Surface;
  if (m.foliage) s = { bump: 0.05, freq: 1.6, rough: 0.1, vary: 0.3, streak: 0 };
  else if (m.metalness >= 0.5) s = { bump: 0.01, freq: 2, rough: 0.18, vary: 0.05, streak: 1 };
  else if (m.roughness >= 0.7) s = { bump: 0.07, freq: 1.1, rough: 0.15, vary: 0.22, streak: 0 };
  else s = { bump: 0.02, freq: 1.5, rough: 0.08, vary: 0.08, streak: 0 };
  return { ...s, ...(override ?? {}) };
}

/** Program cache key so materials with the same surface share one shader. */
export const surfaceKey = (s: Surface) => `rz:${[s.bump, s.freq, s.rough, s.vary, s.streak].map((v) => v.toFixed(3)).join(",")}`;
