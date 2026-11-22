// Pulse briefing hygiene, pure (tests: tests/briefing-clean.test.ts).
// 22 Nov midday: the model copied a 36-character article id wrong ("[a:7ef10da8-...]"), so a whole story had no working
// citation, and its note to itself ("I've used the article ID exactly as provided… please check") was printed in the brief.
// Fix: the model cites short numbers ([a:7]) that are mapped back to ids here, a story with no working citation is dropped,
// and notes about ids or the source list are removed.

/** Short reference for the prompt: [a:1], [a:2], … in the order the articles are listed. */
export function shortRefs(ids: string[]): { ref: (id: string) => string; expand: (text: string) => string } {
  const n = new Map(ids.map((id, i) => [id, i + 1]));
  const back = new Map(ids.map((id, i) => [String(i + 1), id]));
  return {
    ref: (id) => `[a:${n.get(id)}]`,
    // [a:7], [a: 7], [a:7, a:9], [a:7,9] → [a:<id>] each; unknown numbers are dropped.
    expand: (text) => text.replace(/\[a:\s*(\d+(?:\s*,\s*(?:a:)?\s*\d+)*)\s*\]/gi, (_, list: string) =>
      list.split(",").map((x) => back.get(x.replace(/a:/i, "").trim())).filter(Boolean).map((id) => `[a:${id}]`).join("")),
  };
}

const CITE = /\[a:[0-9a-f-]{36}\]/i;
const META = /^\s*[*_>]*\s*(?:note|n\.b\.)\s*:.*\b(?:article id|id exactly|source list|citation|check it against|as provided)\b/i;

/** Removes notes about ids/sources, and every ### story that ends up with no working citation (its facts can't be checked).
 *  Section headings left with no story are removed too. */
export function cleanBriefing(text: string): { text: string; dropped: string[] } {
  const lines = text.split("\n").filter((l) => !META.test(l));
  const dropped: string[] = [];
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^###\s/.test(lines[i])) { out.push(lines[i]); continue; }
    let j = i + 1;
    while (j < lines.length && !/^#{1,3}\s/.test(lines[j])) j++;
    const block = lines.slice(i, j);
    if (block.slice(1).some((l) => CITE.test(l))) out.push(...block);
    else dropped.push(lines[i].replace(/^###\s*/, "").trim());
    i = j - 1;
  }
  // a ## section whose stories all went (and had no cited text of its own)
  const final: string[] = [];
  for (let i = 0; i < out.length; i++) {
    if (/^##\s/.test(out[i]) && !/^###/.test(out[i])) {
      let j = i + 1;
      while (j < out.length && !/^##\s/.test(out[j])) j++;
      const body = out.slice(i + 1, j);
      const story = body.some((l) => /^###\s/.test(l)) || body.some((l) => CITE.test(l));
      const keepPlain = /next steps/i.test(out[i]) && body.some((l) => l.trim());
      if (!story && !keepPlain) { i = j - 1; continue; }
    }
    final.push(out[i]);
  }
  return { text: final.join("\n").replace(/\n{3,}/g, "\n\n").trim(), dropped };
}
