// ws_inspire_image, pure side: reference metadata from a web image search (never the pictures themselves), CORE's ORIGINAL text
// brief and its check, and the CREDITS.md entry of a picture generated from that brief. Network/disk side: site-inspire.ts.
// Legal line: a found picture is never copied, saved or sent to a generator; only generic words written by CORE are.
import type { Credit } from "./site-pipeline-pure.ts";

export type Ref = { title: string; tags: string[]; source: string };
const text = (v: unknown, max = 100) => (typeof v === "string" ? v.replace(/<[^>]*>/g, "").replace(/[\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Openverse search JSON (any license: only words are used) → titles, tags and the page link. No image URLs are kept. */
export function parseRefs(json: unknown): Ref[] {
  const rows = ((json as { results?: unknown[] })?.results ?? []) as { title?: unknown; tags?: { name?: unknown }[]; foreign_landing_url?: unknown }[];
  return rows.slice(0, 10).map((r) => ({ title: text(r.title), tags: (r.tags ?? []).map((t) => text(t?.name, 30)).filter(Boolean).slice(0, 8), source: text(r.foreign_landing_url, 300) }))
    .filter((r) => r.title || r.tags.length);
}

export const BRIEF_FIELDS = ["subject", "mood", "palette", "lighting", "composition", "style"] as const;
export type Brief = Record<(typeof BRIEF_FIELDS)[number], string>;

// shortcut: a short list of the names CORE is most likely to echo from references; the capital-letter rule below catches most others.
const NAMES = /\b(nike|adidas|puma|apple|google|coca[- ]?cola|pepsi|starbucks|mcdonald'?s|ikea|lego|disney|pixar|marvel|dc comics|nintendo|pokemon|pok[eé]mon|mario|mickey|minnie|donald duck|batman|superman|spider-?man|hello kitty|barbie|star wars|harry potter|ghibli|banksy|picasso|van gogh|monet|warhol|dali|kahlo|hokusai|rembrandt|vermeer|basquiat|kusama|haring|mucha|klimt|rockwell|greg rutkowski)\b/i;
const MARKS = /\b(logos?|brand(?:ed|s)?|trademarks?|watermarks?|copyright|celebrit(?:y|ies)|famous|character from|mascot)\b|[™®©]|\b(?:in|after) the (?:style|manner) of\b|\bstyle of\b|\binspired by\b|\bà la\b|\bby (?:the )?(?:artist|photographer|painter|illustrator)\b/i;

/** The brand, character, artist or "in the style of" words in a text, or "" (ws_picture_draft prompts). */
export const brandIn = (v: string) => NAMES.exec(v)?.[0] ?? MARKS.exec(v)?.[0] ?? "";

/** CORE's brief → the generation prompt, or why it was refused. Generic descriptors only: no brands, logos, people, characters or artists. */
export function checkBrief(input: unknown): { brief: Brief; prompt: string } | string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return `brief must be an object with ${BRIEF_FIELDS.join(", ")}`;
  const b = {} as Brief;
  for (const k of BRIEF_FIELDS) {
    const v = text((input as Record<string, unknown>)[k], 200);
    if (!v) return `brief.${k} is missing`;
    const bad = NAMES.exec(v)?.[0] ?? MARKS.exec(v)?.[0];
    if (bad) return `brief.${k} names "${bad}": write an original brief in generic words only (no brands, logos, trademarks, characters, real people, artists or "in the style of")`;
    // A capital inside a field (not its first letter or after a full stop) reads as a proper name.
    const proper = /(?<![.!?]\s|^)\b[A-Z][a-z]+/.exec(v)?.[0];
    if (proper) return `brief.${k} has "${proper}", which reads as a name: use lowercase generic words`;
    b[k] = v;
  }
  return { brief: b, prompt: `${b.subject}. Mood: ${b.mood}. Palette: ${b.palette}. Lighting: ${b.lighting}. Composition: ${b.composition}. Style: ${b.style}. Original image, no text, no logos, no watermark.` };
}

export const GEN_LICENSE = "AI-generated from an original brief — no reference image used as input";
/** The CREDITS.md entry of a generated picture: the brief is recorded as its title. */
export const generatedCredit = (path: string, prompt: string, model: string): Credit =>
  ({ path, title: `Brief: ${prompt.slice(0, 400)}`, author: `Higgsfield ${model}`, license: GEN_LICENSE, attribution: false, source: "generated in ORBIT", via: "Higgsfield" });

/** No generator: CORE falls back to licensed images, then SVG. Weekly cap 0 means no spending at all. */
export const generatorOff = (env: Record<string, string | undefined>) => env.ORBIT_HIGGSFIELD_WEEKLY_CAP?.trim() === "0";
