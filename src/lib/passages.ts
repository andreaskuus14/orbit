// Query-time passage selection for long memories: instead of the first N chars, show CORE the passages
// that best match the question (lexical BM25 + phrase/number/name boosts), labelled for citation. Pure, no network.

export type Passage = { n: number; path: string[]; text: string };

const HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;

/** Split at markdown headings and blank-line paragraphs into ~min..max char passages, each tagged with its heading path. */
export function splitPassages(text: string, min = 800, max = 1200): Passage[] {
  const out: Passage[] = [];
  const path: string[] = [];
  let buf = "";
  let bufPath: string[] = [];
  const flush = () => {
    if (buf.trim()) out.push({ n: out.length + 1, path: bufPath, text: buf.trim() });
    buf = "";
  };
  const add = (block: string) => {
    if (buf && buf.length + block.length + 2 > max) flush();
    if (!buf) bufPath = [...path];
    // An oversized paragraph is cut at sentence ends (or hard at max) so no passage blows the budget.
    while (block.length > max) {
      let cut = Math.max(block.lastIndexOf(". ", max), block.lastIndexOf("\n", max));
      if (cut < min / 2) cut = block.lastIndexOf(" ", max);
      if (cut < min / 2) cut = max;
      buf += block.slice(0, cut + 1);
      flush();
      bufPath = [...path];
      block = block.slice(cut + 1).trimStart();
    }
    buf += (buf ? "\n\n" : "") + block;
    if (buf.length >= min) flush();
  };
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n");
    let rest: string[] = [];
    for (const line of lines) {
      const h = line.match(HEADING);
      if (!h) { rest.push(line); continue; }
      if (rest.join("").trim()) add(rest.join("\n"));
      rest = [];
      flush(); // a heading always starts a new passage
      const level = h[1].length;
      path.length = Math.min(path.length, level - 1);
      while (path.length < level - 1) path.push("");
      path.push(h[2]);
    }
    if (rest.join("").trim()) add(rest.join("\n"));
  }
  flush();
  return out;
}

/** Lowercase word stems (any script); crude English suffix stripping only on longer Latin words. */
export function stems(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+(?:[.,][\p{N}]+)*/gu) ?? []).map((w) =>
    w.length > 4 && /^[a-z]+$/.test(w) ? w.replace(/(ing|edly|ed|ies|es|s|ly|ment)$/, "") : w);
}

const STOP = new Set("the a an and or of to in on at for is are was were be by with what which who how when where does do did it this that from as my me i you your".split(" "));

/** BM25 over the passages of one document, plus boosts for query bigrams, numbers and Capitalized names found verbatim. */
export function scorePassages(passages: Passage[], query: string): number[] {
  const q = [...new Set(stems(query).filter((w) => !STOP.has(w)))];
  const docs = passages.map((p) => stems(`${p.path.join(" ")} ${p.text}`));
  const avg = docs.reduce((a, d) => a + d.length, 0) / (docs.length || 1) || 1;
  const df = new Map(q.map((w) => [w, docs.filter((d) => d.includes(w)).length]));
  const qw = stems(query);
  const bigrams = qw.slice(1).map((w, i) => `${qw[i]} ${w}`).filter((b) => !b.split(" ").every((w) => STOP.has(w)));
  const numbers = query.match(/\p{N}+(?:[.,:]\p{N}+)*/gu) ?? [];
  const names = (query.match(/(?<=\S\s+)\p{Lu}[\p{L}\p{N}]+/gu) ?? []);
  return docs.map((d, i) => {
    let s = 0;
    for (const w of q) {
      const tf = d.filter((x) => x === w).length;
      if (!tf) continue;
      const idf = Math.log(1 + (docs.length - df.get(w)! + 0.5) / (df.get(w)! + 0.5));
      s += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * d.length / avg));
    }
    const joined = ` ${d.join(" ")} `;
    const raw = passages[i].text;
    for (const b of bigrams) if (joined.includes(` ${b} `)) s += 1;
    for (const n of numbers) if (raw.includes(n)) s += 2;
    for (const n of names) if (raw.includes(n)) s += 1.5;
    return s;
  });
}

const label = (mem: number, p: Passage) => `[M${mem} §${p.n}${p.path.filter(Boolean).length ? ` ${JSON.stringify(p.path.filter(Boolean).join(" > "))}` : ""}]`;

/**
 * Up to `budget` chars of `content` for memory number `mem`: the whole text when it fits, otherwise the summary
 * (first ~300 chars) plus the best-scoring passages with ±1 neighbours, in document order, each labelled for citation.
 * `scores` overrides the lexical scores (e.g. cosine against passage embeddings, when such exist).
 */
export function selectPassages(content: string, question: string, budget: number, mem: number, scores?: number[]): string {
  if (content.length <= budget) return content;
  const passages = splitPassages(content);
  const s = scores ?? scorePassages(passages, question);
  const cut = content.lastIndexOf(" ", 300);
  const summary = `${content.slice(0, cut > 200 ? cut : 300).trim()} …`;
  const chosen = new Set<number>();
  const cost = (i: number) => label(mem, passages[i]).length + passages[i].text.length + 6;
  let left = budget - summary.length - 2;
  const take = (i: number) => {
    if (i < 0 || i >= passages.length || chosen.has(i) || cost(i) > left) return;
    chosen.add(i);
    left -= cost(i);
  };
  // Best first; ties (incl. no lexical hit at all) fall back to document order, like today's first-N-chars.
  const order = passages.map((_, i) => i).sort((a, b) => s[b] - s[a] || a - b);
  for (const i of order) {
    if (s[i] > 0) { take(i); take(i - 1); take(i + 1); continue; }
    take(i);
    if (!chosen.has(i)) break; // filler stays contiguous from the top instead of skipping to whatever small passage fits
  }
  const picked = [...chosen].sort((a, b) => a - b);
  const parts = picked.map((i, k) => `${k && picked[k - 1] !== i - 1 ? "…\n" : ""}${label(mem, passages[i])}\n${passages[i].text}`);
  return [chosen.has(0) ? "" : summary, ...parts].filter(Boolean).join("\n\n").slice(0, budget);
}
