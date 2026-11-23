// Planet design language (reports/design-language.md): the numbers behind src/app/planet-ui.css and src/components/ui/*.
// One calm surface per planet, one accent per planet (lib/planets.ts colours), text that always passes WCAG AA.
// Pure; tests in tests/planet-ui.test.ts keep planet-ui.css in step with these values.
import { PLANETS } from "./planets.ts";

/** Type scale in px: caption 12 · meta 13 · body 14 · lead 16 · title 20 · display 28. Line heights to a 4 px grid. */
export const TYPE = {
  caption: { size: 12, line: 16, weight: 500 },
  meta: { size: 13, line: 18, weight: 450 },
  body: { size: 14, line: 20, weight: 450 },
  lead: { size: 16, line: 24, weight: 450 },
  title: { size: 20, line: 28, weight: 600 },
  display: { size: 28, line: 32, weight: 600 },
} as const;
export type TypeName = keyof typeof TYPE;

/** Spacing (4 px grid), radii and control heights. */
export const SPACE = [0, 4, 8, 12, 16, 20, 24, 32, 40, 48] as const;
export const RADIUS = { xs: 6, sm: 8, md: 10, lg: 14, xl: 20, pill: 999 } as const;
export const CONTROL = { sm: 28, md: 36, lg: 44 } as const; // lg = touch / phone

/** Neutral palette: near-black with a hint of blue; text in three steps. All hex, so contrast can be checked. */
export const NEUTRAL = {
  bg: "#05070c",        // page behind the shell (the galaxy is darker still)
  surface: "#0c0f17",   // the shell's own surface once composited (glass over bg)
  raised: "#121621",    // cards and rows on the surface
  overlay: "#161b27",   // menus, toasts, the secondary sheet
  ink: "#ecf0f7",       // primary text
  ink2: "#a9b2c3",      // secondary text
  ink3: "#8590a3",      // tertiary: meta, placeholders (still AA on every surface)
  good: "#5fd49b", warn: "#f2bb55", bad: "#f28b82",
} as const;

export type Rgb = [number, number, number];
export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (c: Rgb) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

/** WCAG 2.x relative luminance and contrast ratio. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** a mixed toward b by t (0..1), in sRGB like CSS color-mix(in srgb, …). */
export function mix(a: string, b: string, t: number): string {
  const p = hexToRgb(a), q = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => p[i] + (q[i] - p[i]) * t) as Rgb);
}

export type ShellId = (typeof PLANETS)[number]["id"] | "core" | "profile";
const EXTRA: Record<"core" | "profile", string> = { core: "#7dd3fc", profile: "#94a3b8" };

/** The planet's accent as lib/planets.ts has it (core and profile have their own). */
export function accent(id: ShellId): string {
  return id === "core" || id === "profile" ? EXTRA[id] : (PLANETS.find((p) => p.id === id)?.color ?? EXTRA.core);
}

/** Accent for text and icons: the accent, lightened toward white just enough to reach `min` contrast on the raised surface
 *  (the lightest place accent text sits). Bright accents stay as they are. */
export function accentInk(hex: string, min = 4.5): string {
  for (let t = 0; t <= 1.0001; t += 0.02) { const c = mix(hex, "#ffffff", t); if (contrast(c, NEUTRAL.raised) >= min) return c; }
  return "#ffffff";
}
/** Text on a solid accent fill (primary button): dark ink if it reads at 4.5:1, else white. */
export function onAccent(hex: string): string {
  return contrast(NEUTRAL.bg, hex) >= 4.5 ? NEUTRAL.bg : "#ffffff";
}
/** Solid fill for the primary button: the accent, darkened toward bg only if neither dark nor white text reads on it. */
export function accentFill(hex: string): string {
  for (let t = 0; t <= 0.6; t += 0.02) { const c = mix(hex, NEUTRAL.bg, t); if (contrast(onAccent(c), c) >= 4.5) return c; }
  return mix(hex, NEUTRAL.bg, 0.6);
}

export type AccentSet = { accent: string; ink: string; fill: string; on: string };
export function accentSet(id: ShellId): AccentSet {
  const a = accent(id), fill = accentFill(a);
  return { accent: a, ink: accentInk(a), fill, on: onAccent(fill) };
}
export const SHELL_IDS: ShellId[] = [...PLANETS.map((p) => p.id), "core", "profile"];

/** The CSS custom properties each [data-planet] block in planet-ui.css declares (tests compare them to the file). */
export function accentCss(id: ShellId): string {
  const s = accentSet(id);
  return `[data-planet="${id}"] { --pu-accent: ${s.accent}; --pu-accent-ink: ${s.ink}; --pu-accent-fill: ${s.fill}; --pu-on-accent: ${s.on}; }`;
}

/** Planets whose accents are too close to tell apart side by side (deltaE-ish distance in sRGB below `min`). */
export function closeAccents(min = 40): [ShellId, ShellId][] {
  const out: [ShellId, ShellId][] = [];
  const ids = PLANETS.map((p) => p.id);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = hexToRgb(accent(ids[i])), b = hexToRgb(accent(ids[j]));
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < min) out.push([ids[i], ids[j]]);
  }
  return out;
}

/** Toasts: how long one stays. Errors and ones with a button stay longer; hovering or focusing pauses the timer. */
export function toastMs(t: { tone?: "info" | "done" | "error"; action?: boolean; text: string }): number {
  const base = t.tone === "error" ? 7000 : t.action ? 6000 : 4000;
  return Math.min(10000, base + Math.max(0, t.text.length - 60) * 40); // long text gets reading time
}
/** At most this many toasts on screen; the oldest goes first. */
export const TOAST_MAX = 3;
export function pushToast<T extends { id: string }>(list: T[], t: T): T[] {
  return [...list.filter((x) => x.id !== t.id), t].slice(-TOAST_MAX);
}

/** Menu keyboard: next enabled index for ArrowDown/ArrowUp/Home/End, wrapping, skipping disabled items. */
export function menuMove(disabled: boolean[], from: number, key: "ArrowDown" | "ArrowUp" | "Home" | "End"): number {
  const n = disabled.length;
  if (!n || disabled.every(Boolean)) return -1;
  const step = key === "ArrowUp" || key === "End" ? -1 : 1;
  let i = key === "Home" ? -1 : key === "End" ? n : from;
  for (let k = 0; k < n; k++) { i = (i + step + n) % n; if (!disabled[i]) return i; }
  return -1;
}
/** Typeahead: the first enabled item after `from` whose label starts with `q` (case-insensitive). */
export function menuSeek(labels: string[], disabled: boolean[], from: number, q: string): number {
  const s = q.toLowerCase(), n = labels.length;
  for (let k = 1; k <= n; k++) { const i = (from + k) % n; if (!disabled[i] && labels[i].toLowerCase().startsWith(s)) return i; }
  return from;
}
