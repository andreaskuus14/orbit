// "Look at my screen" (roadmap D3): sizing, request parsing, prompt building and Roblox error pick-out. Tested in tests/screen-look.test.ts.
// Keep this file free of imports and non-erasable TS syntax (it runs under node --experimental-strip-types).

export const LOOK_EDGE = 1568; // same long edge as CORE attachments: more pixels only cost upload time
export const SCREEN_NAME = "screen.jpg";
export const LUAU_FIX_EVENT = "orbit:luau-fix"; // detail: error text; GAME DEV opens the Luau helper in Fix mode with it
export type Preset = "general" | "roblox";

/** Width/height that fit the long edge into `edge`, never upscaled, at least 1 px. */
export function fitSize(w: number, h: number, edge = LOOK_EDGE): { width: number; height: number } {
  if (!(w > 0 && h > 0)) return { width: 1, height: 1 };
  const k = Math.min(1, edge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

const PHRASE = /^(?:hey\s+)?(?:orbit[,\s]+)?(?:(?:can|could) you\s+|please\s+)?(?:look at|check|see|read) (?:my|the|this) (?:screen|window|monitor)\b[\s,.:;!?-]*/i;

/** A typed or spoken "look at my screen …": the rest is the question. null when the message isn't one. */
export function parseLookRequest(text: string): { question: string; preset: Preset } | null {
  const t = text.trim();
  const m = PHRASE.exec(t);
  if (!m) return null;
  const question = t.slice(m[0].length).trim().replace(/^(?:and|then)\s+/i, "");
  return { question, preset: /\b(roblox|studio|luau)\b/i.test(t) ? "roblox" : "general" };
}

const ROBLOX = "This is a screenshot of Roblox Studio. Quote every error or warning visible in the Output window exactly, one per line, each starting with \"Error: \" (if none is visible, say so). Then explain the likely cause and the fix in a few short bullets.";

/** The message sent with the screenshot. The image itself is untrusted data, like any attachment. */
export function lookPrompt(question: string, preset: Preset): string {
  const q = question.trim().slice(0, 2000);
  if (preset === "roblox") return q ? `${ROBLOX}\nMy question: ${q}` : ROBLOX;
  return q || "Look at my screen: what do you see, and is anything wrong?";
}

/** The quoted errors in a Roblox-preset answer ("Error: …" lines), for "Fix with docs". Deduped, at most 3. */
export function robloxErrors(answer: string): string[] {
  const out: string[] = [];
  for (const line of answer.split("\n")) {
    const m = /^\s*(?:[-*•]\s*)?(?:\*\*)?Error:(?:\*\*)?\s*`?(.+?)`?\s*$/i.exec(line);
    const e = m?.[1].trim().slice(0, 500);
    if (e && !/^none\b|^no errors?\b/i.test(e) && !out.includes(e)) out.push(e);
    if (out.length === 3) break;
  }
  return out;
}
