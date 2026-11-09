// Website from one sentence (owner: "a site for my sauna in Lahemaa"): pick a design direction from the idea, ask the model for a
// full W02 brief as JSON (parseBrief's schema), and repair once with the validator's errors. Facts the owner didn't give (prices,
// addresses, opening hours) are written as [brackets] so they read as placeholders to fill, never as invented truth.
// Disk side: site-idea.ts. Tests: tests/site-idea.test.ts.
import type { DirectionId } from "./site-immersive-pure.ts";

/** A direction that suits the subject (the owner can switch it with one word later). */
export function pickDirection(idea: string): DirectionId {
  const t = idea.toLowerCase();
  if (/\b(architect|house|home|interior|sauna|spa|cabin|nordic|wellness|retreat|clinic|studio|furniture|wood)\w*/.test(t)) return "daylight";
  if (/\b(shop|store|fashion|food|restaurant|cafe|café|bakery|event|festival|bar|magazine|brand|merch)\w*/.test(t)) return "editorial";
  return "cinematic"; // games, tech, film, music, apps, nightlife and the rest
}

export const IDEA_SYSTEM = `You write a one-page website brief as JSON for ORBIT's site builder. Output ONLY the JSON object, no prose, no code fences.
Schema:
{"name": string (brand, max 60), "tagline": string (max 80, short eyebrow), "offer": string (one sentence: what, for whom), "audience": string,
 "description": string (max 160, for search results), "lang": "en" or "et",
 "sections": [
  {"kind":"hero","heading": string (put ONE word in *stars* for the accent),"body":[string],"cta":[{"label":string,"href":"#<section id>"}]},
  {"kind":"features","heading":string,"body":[string],"items":[{"label": short stat like "72 h","title":string,"body":string} x3]},
  {"kind":"story","heading":string,"body":[string, string]},
  {"kind":"specs","heading":string,"items":[{"title":string,"body":string} x4-6]},
  {"kind":"faq","heading":string,"items":[{"title":question,"body":answer} x3-4]},
  {"id":"contact","kind":"form","heading":string,"body":[string],"ask":{"label":string,"options":[string x3-4]}}
 ]}
Rules: write like the business's own best copywriter: specific, concrete, no hype words ("revolutionary", "unleash", "elevate"), no emoji.
Every href is "#contact" or "#<id of a section you gave an id>". Only facts from the owner's sentence are facts; anything else a visitor
would need (prices, address, hours, dates, numbers) goes in [square brackets] as a placeholder for the owner to fill, e.g. "[price] € per evening".
No images: omit "assets" and "image".`;

export const ideaPrompt = (idea: string, lang: "en" | "et") => `The owner's idea: ${idea.slice(0, 600)}\nWrite the brief in ${lang === "et" ? "Estonian" : "English"}.`;
export const repairPrompt = (idea: string, lang: "en" | "et", errors: string[]) => `${ideaPrompt(idea, lang)}\nYour last JSON had these problems; fix them and output the whole JSON again:\n- ${errors.slice(0, 12).join("\n- ")}`;

/** The first JSON object in a model reply (tolerates code fences and a stray sentence around it). */
export function firstJson(text: string): unknown {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}
/** Placeholders the owner still has to fill, for the result message. */
export const placeholders = (brief: unknown) => [...new Set(JSON.stringify(brief ?? "").match(/\[[^\]"]{2,40}\]/g) ?? [])].slice(0, 12);
/** A workspace name from the brand: "Tuuli Sauna" → "tuuli-sauna-site". */
export const siteSlugName = (name: string) => `${name.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 30) || "site"}-site`;
