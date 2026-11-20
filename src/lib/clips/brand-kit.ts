import path from "node:path";
import { DEFAULT_KIT, parseBrandKit, type BrandKit } from "../brand-kit-pure";
import { readState, saveState, studioRoot } from "./factory";

// STUDIO brand kit storage: <studio>/brand.json, written like publish.json (readState/saveState). Missing or damaged = the defaults,
// which draw exactly what ORBIT drew before the kit existed (brand-kit-pure.ts).
export async function readBrandKit(): Promise<BrandKit> {
  const x = await readState<unknown>(studioRoot(), "brand", (v) => { const r = parseBrandKit(v); return typeof r === "string" ? r : ""; }).catch(() => null);
  const kit = x == null ? null : parseBrandKit(x);
  return kit && typeof kit !== "string" ? kit : DEFAULT_KIT;
}
/** Applies a partial change on top of the stored kit; returns the saved kit or the problem. reset = back to the defaults. */
export async function saveBrandKit(patch: unknown, reset = false): Promise<BrandKit | string> {
  const next = reset ? DEFAULT_KIT : parseBrandKit(patch, await readBrandKit());
  if (typeof next === "string") return next;
  await saveState("brand", path.join(studioRoot(), "brand.json"), next);
  return next;
}
