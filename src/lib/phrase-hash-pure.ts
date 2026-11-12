// Phrase hashes of private text (core-taint.json): the egress check survives a restart without journal text on disk. HMAC-SHA256
// with a per-install random key (durable.ts hashKey(), 0600 in the data dir), so the file alone can't be dictionary-guessed.
// Server-only (node:crypto); outbound-pure stays importable by the demo build.
import { createHmac } from "node:crypto";
import { RUN, decodeURIComponentSafe, outRuns, tokens, words } from "./outbound-pure.ts";

const phraseHash = (p: string, key: string | Buffer) => createHmac("sha256", key).update(p).digest("hex").slice(0, 16);
/** Hashes of every RUN-word phrase in private text: kept on disk (core-taint.json) instead of the text, so the check survives a restart. */
export function phraseHashes(texts: readonly string[], key: string | Buffer): string[] {
  const out = new Set<string>();
  for (const t of texts) { const w = tokens(t); for (let i = 0; i + RUN <= w.length; i++) out.add(phraseHash(w.slice(i, i + RUN).join(" "), key)); } // tokens only: one split keeps the 20k cap
  return [...out];
}
/** The outgoing phrase whose hash is in `hashes` (private text from before a restart), or "". Phrases he typed in his message don't count. */
export function hashLeak(out: string, hashes: readonly string[], key: string | Buffer, question = ""): string {
  if (!hashes.length) return "";
  const set = new Set(hashes), o = decodeURIComponentSafe(out);
  for (const tok of [words, tokens]) { // words: hashes stored before tokens() existed still match
    const qw = ` ${tok(question).join(" ")} `;
    for (const p of outRuns(o, tok)) { if (!qw.includes(` ${p} `) && set.has(phraseHash(p, key))) return p; }
  }
  return "";
}
