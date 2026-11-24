// ARCH planet shell: the small rules behind the calm panel and the on-demand 3D (planet-map.md § ARCH).
// Pure, so the render-loop and save decisions are tested in node.
import type { Lang } from "./i18n-pure";

/** One locale per language for every date, time and number on the planet (no more "et-EE" inside English text). */
export const locale = (lang: Lang) => (lang === "et" ? "et-EE" : "en-GB");
export const clock = (d: Date | null, lang: Lang) => (d ? d.toLocaleTimeString(locale(lang), { hour: "2-digit", minute: "2-digit", hour12: false }) : "—");
export const num = (n: number, lang: Lang, digits = 0) => n.toLocaleString(locale(lang), { maximumFractionDigits: digits });
export const money = (n: number, lang: Lang) => n.toLocaleString(locale(lang), { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

/** What the scene needs to keep drawing on its own. Everything else draws only when something changes (frameloop "demand"). */
export function needsLoop(s: { building: boolean; holo: boolean; reduced: boolean; walk: boolean; spin: boolean; scan: boolean }): boolean {
  return s.building || s.walk || s.scan || (!s.reduced && (s.holo || s.spin));
}

/** How long the build animation runs: one part every `step` s after a 0.6 s pause, plus a second to settle. */
export const buildMs = (parts: number, step: number) => Math.round((0.6 + Math.max(0, parts) * step + 1) * 1000);

/** Shadows only where they show something: the realistic house, or the sun study in the plain model. Never on the
 *  hologram or a scan (dark, unlit looks). */
export const shadowsOn = (s: { real: boolean; sun: boolean; holo: boolean; scan: boolean }) => !s.holo && !s.scan && (s.real || s.sun);

/** Shadow map size from the quality preset: lean machines get 1024, everything else 2048 (4096 cost 4× for no visible gain). */
export const shadowMap = (bloomScale: number): [number, number] => (bloomScale > 0 ? [2048, 2048] : [1024, 1024]);

/** Save timing: wait this long after the last edit, then write when the browser is idle. */
export const SAVE_WAIT_MS = 800;

export type SunFact = { key: "arch.sunUp" | "arch.sunDown"; vars: Record<string, string | number> };
/** The sun line as one i18n key with its numbers, so English and Estonian both read whole sentences. */
export function sunFact(elevationDeg: number, azimuthDeg: number): SunFact {
  return elevationDeg < 0 ? { key: "arch.sunDown", vars: {} } : { key: "arch.sunUp", vars: { alt: Math.round(elevationDeg), az: Math.round(azimuthDeg) } };
}
