// STUDIO brand kit (pure; tests in tests/brand-kit.test.ts): one stored look (caption font/size/colours/outline/position, hook card,
// accent colours, optional intro/outro card text, thumbnail look) that every render path reads: buildAss (clips/pure.ts), the
// Hyperframes composition (clips/hyperframes-pure.ts) and thumbSvg. DEFAULT_KIT equals the values that were hard-coded before the kit
// existed, so nothing changes until the owner edits it (tests/brand-golden.test.ts proves the default output byte for byte).
// Storage and the settings route: clips/brand-kit.ts, app/api/studio/brand/route.ts.

export type BrandKit = {
  caption: { font: string; size: number; text: string; highlight: string; shout: string; outline: string; outlineWidth: number; bottom: number; left: number; right: number };
  hook: { font: string; size: number; text: string; box: string; top: number };
  card: { intro: string; outro: string };
  thumb: { accent: string; text: string };
};
/** font "" = ORBIT's own choice (Arial in burned captions, Montserrat in Hyperframes, Arial Black in thumbnails). */
export const DEFAULT_KIT: BrandKit = {
  caption: { font: "", size: 100, text: "#ffffff", highlight: "#ffe500", shout: "#ff2e63", outline: "#000000", outlineWidth: 10, bottom: 640, left: 70, right: 150 },
  hook: { font: "", size: 92, text: "#ffffff", box: "#ff2e63", top: 260 },
  card: { intro: "", outro: "" },
  thumb: { accent: "#ff2e63", text: "#ffffff" },
};

export const KIT_LIMITS = { size: [40, 200], hookSize: [40, 160], outlineWidth: [0, 30], margin: [0, 1400], bottom: [100, 1300], hookTop: [40, 1200], text: 40, font: 40 } as const;
const FONT_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/; // no commas (the ASS style line), quotes, braces or backslashes
const HEX_RE = /^#[0-9a-f]{6}$/i;
const clean = (s: string) => s.replace(/[\x00-\x1f\x7f<>{}\\]/g, " ").replace(/\s+/g, " ").trim();

const num = (v: unknown, [lo, hi]: readonly [number, number] | readonly number[], what: string): number | string =>
  typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= lo && v <= hi ? v : `${what} must be a whole number from ${lo} to ${hi}`;
const colour = (v: unknown, what: string): string | string[] => (typeof v === "string" && HEX_RE.test(v) ? v.toLowerCase() : [`${what} must be a colour like #ffe500`]) as string | string[];

/** Full or partial kit (missing parts keep the defaults) → a valid kit, or the first problem as a sentence. */
export function parseBrandKit(x: unknown, base: BrandKit = DEFAULT_KIT): BrandKit | string {
  if (x == null || typeof x !== "object" || Array.isArray(x)) return "brand kit must be an object";
  const o = x as Record<string, Record<string, unknown> | undefined>;
  for (const k of ["caption", "hook", "card", "thumb"]) if (o[k] !== undefined && (o[k] === null || typeof o[k] !== "object" || Array.isArray(o[k]))) return `${k} must be an object`;
  const kit: BrandKit = JSON.parse(JSON.stringify(base));
  const err: string[] = [];
  const set = <S extends object, K extends keyof S>(sec: S, key: K, v: unknown, kind: "colour" | "font" | "text" | readonly number[], what: string) => {
    if (v === undefined) return;
    let r: unknown;
    if (kind === "colour") { r = colour(v, what); if (Array.isArray(r)) return void err.push(r[0]); }
    else if (kind === "font") {
      r = typeof v === "string" ? v.trim() : v;
      if (typeof r !== "string" || (r !== "" && (r.length > KIT_LIMITS.font || !FONT_RE.test(r)))) return void err.push(`${what} must be a plain font name (letters, digits, spaces) up to ${KIT_LIMITS.font} characters, or empty for ORBIT's own`);
    } else if (kind === "text") {
      if (typeof v !== "string") return void err.push(`${what} must be text`);
      r = clean(v);
      if ((r as string).length > KIT_LIMITS.text) return void err.push(`${what} can be at most ${KIT_LIMITS.text} characters`);
    } else { r = num(v, kind, what); if (typeof r === "string") return void err.push(r); }
    sec[key] = r as S[K];
  };
  const c = o.caption ?? {}, h = o.hook ?? {}, cd = o.card ?? {}, t = o.thumb ?? {};
  set(kit.caption, "font", c.font, "font", "Caption font"); set(kit.caption, "size", c.size, KIT_LIMITS.size, "Caption size");
  set(kit.caption, "text", c.text, "colour", "Caption colour"); set(kit.caption, "highlight", c.highlight, "colour", "Spoken-word colour");
  set(kit.caption, "shout", c.shout, "colour", "Shouted-word colour"); set(kit.caption, "outline", c.outline, "colour", "Outline colour");
  set(kit.caption, "outlineWidth", c.outlineWidth, KIT_LIMITS.outlineWidth, "Outline width"); set(kit.caption, "bottom", c.bottom, KIT_LIMITS.bottom, "Caption height from the bottom");
  set(kit.caption, "left", c.left, KIT_LIMITS.margin, "Left margin"); set(kit.caption, "right", c.right, KIT_LIMITS.margin, "Right margin");
  set(kit.hook, "font", h.font, "font", "Hook font"); set(kit.hook, "size", h.size, KIT_LIMITS.hookSize, "Hook size");
  set(kit.hook, "text", h.text, "colour", "Hook text colour"); set(kit.hook, "box", h.box, "colour", "Hook box colour"); set(kit.hook, "top", h.top, KIT_LIMITS.hookTop, "Hook height from the top");
  set(kit.card, "intro", cd.intro, "text", "Intro text"); set(kit.card, "outro", cd.outro, "text", "Outro text");
  set(kit.thumb, "accent", t.accent, "colour", "Thumbnail accent colour"); set(kit.thumb, "text", t.text, "colour", "Thumbnail text colour");
  if (err.length) return err[0];
  if (kit.caption.left + kit.caption.right > 1000) return "The caption margins leave no room for text on a 1080 px screen";
  return kit;
}

const FNV = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, "0"); };
/** Short id of the look (every field above changes how a clip is drawn): stored on a clip when it is rendered. */
export const kitId = (k: BrandKit): string => FNV(JSON.stringify(k));
export const DEFAULT_KIT_ID = kitId(DEFAULT_KIT);
export const isDefaultKit = (k: BrandKit) => kitId(k) === DEFAULT_KIT_ID;

/** #rrggbb → libass "&HBBGGRR" (+ "&" for override tags). */
const bgr = (hex: string) => hex.slice(5, 7).toUpperCase() + hex.slice(3, 5).toUpperCase() + hex.slice(1, 3).toUpperCase();
export const assStyleColour = (hex: string) => `&H00${bgr(hex)}`;
export const assTagColour = (hex: string) => `&H${bgr(hex)}&`;

/** The intro / outro card lines for the ASS file (empty kit → none). */
export function cardEvents(kit: BrandKit, duration: number, time: (s: number) => string, text: (s: string) => string): string[] {
  const ev: string[] = [], len = Math.max(0, duration);
  const intro = kit.card.intro.trim(), outro = kit.card.outro.trim();
  if (intro && len > 0) ev.push(`Dialogue: 2,${time(0)},${time(Math.min(CARD_SEC, len))},Card,,0,0,0,,${text(intro).toUpperCase()}`);
  if (outro && len > CARD_SEC) ev.push(`Dialogue: 2,${time(len - CARD_SEC)},${time(len)},Card,,0,0,0,,${text(outro).toUpperCase()}`);
  return ev;
}
export const CARD_SEC = 1.5;
export const cardsOn = (k: BrandKit) => !!(k.card.intro.trim() || k.card.outro.trim());

// ---- "matches brand kit" check (STUDIO publish checks: a warning, never a blocker) ----

type Rendered = { video?: string; brand?: string; status?: string };
/** Why a rendered clip doesn't look like the current brand kit, or null. A clip with no stamp was rendered before the kit existed, so it
 *  has the default look. A clip with no video yet, or a kit that never changed, has nothing to compare. */
export function brandIssue(clip: Rendered, kit: BrandKit): string | null {
  if (!clip.video) return null;
  const was = clip.brand ?? DEFAULT_KIT_ID;
  if (was === kitId(kit)) return null;
  return "This clip was rendered with a different caption and thumbnail look than your brand kit now has. Make another version to apply the kit, or publish it as it is.";
}
