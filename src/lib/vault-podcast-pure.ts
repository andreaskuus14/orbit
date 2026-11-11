// VAULT podcast: a short two-voice show about the files the user picked. A model writes the dialogue from those VAULT files only
// (no journal or LIFE text ever goes in); this file builds the prompt, parses the reply into lines, and names the cache entry.
// Voices, speech cleanup and pauses are briefing-audio-pure's (the audio briefing). IO: vault-podcast.ts. Tests: tests/vault-podcast.test.ts.
import { createHash } from "node:crypto";
import { speech, type Line } from "./briefing-audio-pure.ts";

export const MAX_FILES = 6, MAX_LINES = 40, SOURCE_CHARS = 30000;

export const PODCAST_SYSTEM = `You write a short two-person podcast script about the documents given.
HOST asks and frames; GUEST explains. Use only facts from the documents; say so when they disagree or are unclear.
Plain spoken English, no Markdown, no stage directions. 12 to 30 turns, each 1 to 4 sentences.
Every line starts with "HOST:" or "GUEST:".`;

/** The model input: each file's text under its name, shared fairly within the budget. */
export function sourceText(docs: { name: string; text: string }[], budget = SOURCE_CHARS): string {
  const use = docs.filter((d) => d.text.trim()).slice(0, MAX_FILES), each = Math.floor(budget / Math.max(1, use.length));
  return use.map((d) => `=== ${d.name} ===\n${d.text.trim().slice(0, each)}`).join("\n\n");
}

/** "HOST: …" / "GUEST: …" lines into the briefing's anchor/analyst voices; follow-on lines join the last speaker. */
export function parseDialogue(text: string): Line[] {
  const out: Line[] = [];
  for (const raw of text.split("\n")) {
    const m = /^\s*\**\s*(HOST|GUEST)\s*\**\s*:\s*(.*)$/i.exec(raw);
    const said = speech(m ? m[2] : raw);
    if (!said) continue;
    if (m) out.push({ who: m[1].toUpperCase() === "HOST" ? "anchor" : "analyst", text: said });
    else if (out.length) out[out.length - 1].text += ` ${said}`;
  }
  return out.slice(0, MAX_LINES).map((l) => ({ ...l, text: l.text.slice(0, 900) }));
}

/** Same files at the same versions → same cached show. */
export const cacheKey = (files: { name: string; mtime: number }[]) =>
  createHash("sha256").update(JSON.stringify([...files].sort((a, b) => a.name.localeCompare(b.name)).map((f) => [f.name, f.mtime]))).digest("hex").slice(0, 24);
