// Pure text helpers for spoken answers: Markdown → plain speakable text, and a streaming sentence chunker.
// No imports, no DOM: tested in tests/speech-text.test.ts.

/** Strip Markdown so a speech engine reads words, not symbols. Each line ends with a pause (a period if it has none). */
export function cleanForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?(?:```|$)/g, "\nCode omitted.\n")
    .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, "") // table separator rows
    .replace(/^[ \t]*\|(.*?)\|?[ \t]*$/gm, (_, row: string) => row.split("|").map((c) => c.trim()).filter(Boolean).join(", "))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\((?:[^()\s]|\([^)]*\))*\)/g, "$1")
    .replace(/\[(?:\d+|m:[^\]\s]+)\]/g, "") // citation markers [1] / [m:uuid]
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
    .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, "")
    .replace(/^[ \t]*(?:[-*+•]|\d+[.)])[ \t]+/gm, "")
    .replace(/(?<!\w)(\*\*|__|\*|_|~~)(?=\S)(.+?)(?<=\S)\1(?!\w)/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").replace(/ ([.,!?;:])/g, "$1").trim()) // removed markers leave "docs ."
    .filter(Boolean)
    .map((l) => (/[.!?:;,]$/.test(l) ? l : `${l}.`))
    .join(" ");
}

// A dot after these is not a sentence end: e.g., i.e., U.S. (single letters), Dr., list numbers "1.".
// shortcut: "in the U.S. Then" is not split either; fine for speech (it just makes one longer chunk).
const ABBR = /(?:^|[\s(])(?:etc|vs|mr|mrs|ms|dr|prof|sr|jr|st|no|approx|fig|inc|ltd)$|(?:^|[\s(.])[a-z]$|^\s*\d+$/i;

/** Index just past the next safe cut in buf, or -1 to wait for more text. */
function nextCut(buf: string, final: boolean): number {
  for (let i = 0; i < buf.length; i++) {
    if (buf.startsWith("```", i)) { // a code block is one piece; wait until it closes
      const close = buf.indexOf("```", i + 3);
      if (close < 0) return final ? buf.length : -1;
      const nl = buf.indexOf("\n", close + 3);
      return nl < 0 ? (final ? buf.length : -1) : nl + 1;
    }
    const ch = buf[i];
    if (ch === "\n") return i + 1;
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    let j = i + 1;
    for (;;) { // closers after the punctuation: quotes, brackets, emphasis, citation markers
      if (j < buf.length && "\"')]*_”’".includes(buf[j])) { j++; continue; }
      const cite = /^\[[^\]\s]*\]/.exec(buf.slice(j, j + 60));
      if (cite) { j += cite[0].length; continue; }
      break;
    }
    if (j >= buf.length) return final ? buf.length : -1;
    if (/\s/.test(buf[j]) && (ch !== "." || !ABBR.test(buf.slice(0, i)))) return j;
  }
  return final && buf.length ? buf.length : -1;
}

/** Split chunks that would run past Chrome's ~15 s utterance cutoff, at a comma or space. */
export function splitLong(s: string, max = 200): string[] {
  const out: string[] = [];
  while (s.length > max) {
    let i = Math.max(s.lastIndexOf(", ", max), s.lastIndexOf("; ", max));
    if (i < max / 3) i = s.lastIndexOf(" ", max);
    if (i <= 0) i = max - 1;
    out.push(s.slice(0, i + 1).trim());
    s = s.slice(i + 1).trim();
  }
  if (s) out.push(s);
  return out;
}

/** Feed streamed Markdown deltas; get back cleaned sentences ready to speak. flush() returns the rest. */
export function sentenceStream() {
  let buf = "";
  const drain = (final: boolean) => {
    const out: string[] = [];
    for (let c = nextCut(buf, final); c > 0; c = nextCut(buf, final)) {
      out.push(...splitLong(cleanForSpeech(buf.slice(0, c))));
      buf = buf.slice(c);
    }
    return out;
  };
  return {
    push: (delta: string) => { buf += delta; return drain(false); },
    flush: () => drain(true),
    reset: () => { buf = ""; },
  };
}

/** A whole Markdown text as speakable chunks (for replaying a finished answer). */
export function speechChunks(md: string): string[] {
  const s = sentenceStream();
  return [...s.push(md), ...s.flush()];
}
