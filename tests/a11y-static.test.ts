// Static a11y lint: every <button> needs a name (text child, aria-label/labelledby or title) and every <img> needs alt.
// Pure text scan of .tsx files, so it runs in plain node --test without a browser or a JSX parser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Opening tag starting at i ("<tag ..."): returns its attribute text and end index, skipping {...} so "=>" is not the end.
function openTag(src: string, i: number): { attrs: string; end: number; selfClosing: boolean } {
  let depth = 0, q = "";
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (q) { if (c === q && src[j - 1] !== "\\") q = ""; continue; }
    if (depth && (c === '"' || c === "'" || c === "`")) { q = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return { attrs: src.slice(i, j), end: j + 1, selfClosing: src[j - 1] === "/" };
  }
  return { attrs: src.slice(i), end: src.length, selfClosing: true };
}

const NAMED = /\b(aria-label|aria-labelledby|title)\s*=|\{\s*\.\.\./; // a spread may carry the name: trust it

// Text a screen reader would get from the children: any letter/digit in literal text, or any {expression} (may be a string).
function hasText(children: string): boolean {
  const noTags = children.replace(/<[^>]*>/g, " ");
  if (/\{(?!\s*\/\*)/.test(noTags)) return true;
  return /[\p{L}\p{N}]/u.test(noTags);
}

export function lint(src: string): string[] {
  const out: string[] = [];
  const line = (i: number) => src.slice(0, i).split("\n").length;
  for (const m of src.matchAll(/<(button|img)\b/g)) {
    const i = m.index!;
    const { attrs, end, selfClosing } = openTag(src, i);
    if (m[1] === "img") { if (!/\balt\s*=|\{\s*\.\.\./.test(attrs)) out.push(`${line(i)}: <img> without alt`); continue; }
    if (NAMED.test(attrs)) continue;
    const close = selfClosing ? end : src.indexOf("</button>", end);
    if (selfClosing || !hasText(src.slice(end, close < 0 ? end : close))) out.push(`${line(i)}: <button> without text or aria-label`);
  }
  return out;
}

function tsx(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? tsx(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : []);
}

// Justified exceptions as "path:line-text-fragment". Keep empty unless a case is truly decorative.
const ALLOW: string[] = [];

test("lint catches unnamed buttons and alt-less images", () => {
  assert.deepEqual(lint(`<button onClick={() => x()}><svg/></button>`), ["1: <button> without text or aria-label"]);
  assert.deepEqual(lint(`<button>×</button>`), ["1: <button> without text or aria-label"]);
  assert.deepEqual(lint(`<button onClick={() => a > b}>Save</button>`), []);
  assert.deepEqual(lint(`<button aria-label="Close">×</button>`), []);
  assert.deepEqual(lint(`<button>{t("go")}</button>`), []);
  assert.deepEqual(lint(`<img src={s} />`), ["1: <img> without alt"]);
  assert.deepEqual(lint(`<img src={s} alt="" />`), []);
});

test("every .tsx button has a name and every img has alt", () => {
  const bad = tsx("src").flatMap((f) => lint(readFileSync(f, "utf8")).map((e) => `${f}:${e}`)).filter((e) => !ALLOW.some((a) => e.startsWith(a)));
  assert.deepEqual(bad, []);
});
