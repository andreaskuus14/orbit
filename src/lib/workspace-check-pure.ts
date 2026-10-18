// "Check before showing" for workspace sites: pure rules (asset refs, contrast math, overflow, the summary line), tested in
// tests/workspace-check.test.ts. The headless render that feeds them is workspace-check.ts.

/** Local files an HTML page references (src= on any tag, href= on <link>), resolved against the page's folder. Absolute URLs,
 *  data:/blob:/mailto:, "#x" and "//host" are not local. Query/hash dropped. A path that climbs out of the workspace is kept as
 *  "../…"; a root path ("/x.css") is kept as is. */
export function localRefs(html: string, page = "index.html"): string[] {
  const base = page.split("/").slice(0, -1);
  const out = new Set<string>();
  const noComments = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const m of noComments.matchAll(/<(link|[a-z][a-z0-9-]*)\b[^>]*?\s(src|href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    if (m[2].toLowerCase() === "href" && m[1].toLowerCase() !== "link") continue; // <a href> is a link, not a resource
    const raw = (m[4] ?? m[5] ?? m[6] ?? "").trim();
    if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(raw)) continue;
    const clean = raw.replace(/[?#].*$/, "");
    if (clean.startsWith("/")) { out.add(clean); continue; } // root path: points at ORBIT, not the workspace (see staticIssues)
    const parts = [...base];
    for (const s of clean.split("/")) {
      if (!s || s === ".") continue;
      if (s === "..") { if (parts.length && parts[parts.length - 1] !== "..") parts.pop(); else parts.push(".."); } else parts.push(s);
    }
    if (parts.length) out.add(parts.map((p) => { try { return decodeURIComponent(p); } catch { return p; } }).join("/"));
  }
  return [...out];
}

/** External http(s) URLs the HTML loads (blocked in preview). */
export const externalRefs = (html: string) =>
  [...new Set([...html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<(?:script|link|img|iframe|source|video|audio)\b[^>]*?\s(?:src|href)\s*=\s*["']?((?:https?:)?\/\/[^"'\s>]+)/gi)].map((m) => m[1]))];

/** Static checks (no browser): missing local assets, external loads, a title, some visible text or media. */
export function staticIssues(html: string, page: string, files: Set<string>): string[] {
  const out: string[] = [];
  for (const r of localRefs(html, page)) {
    if (r.startsWith("/")) out.push(`root path ${r} won't load in the preview: use a relative path (no leading /)`);
    else if (!files.has(r)) out.push(`missing file: ${r} (referenced by ${page})`);
  }
  for (const u of externalRefs(html).slice(0, 5)) out.push(`loads an external URL (blocked in preview): ${u.slice(0, 120)}`);
  if (!/<title[^>]*>\s*\S[\s\S]*?<\/title>/i.test(html)) out.push("no <title>");
  const body = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "").replace(/<head\b[\s\S]*?<\/head>|<title\b[\s\S]*?<\/title>/gi, "");
  if (!/<(?:img|svg|canvas|video|button|input)\b/i.test(body) && !body.replace(/<[^>]*>/g, "").trim() && !/<script\b/i.test(html)) out.push("page is blank (no text or media)");
  return out;
}

export type Rgba = [number, number, number, number];
/** Chrome's computed colours: "rgb(1, 2, 3)", "rgba(1, 2, 3, 0.5)" or "rgb(1 2 3 / 50%)"; null for anything else (color(), etc.). */
export function parseColor(s: string): Rgba | null {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(s.trim());
  if (!m) return null;
  const a = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
  return [Number(m[1]), Number(m[2]), Number(m[3]), Math.max(0, Math.min(1, a))];
}
const over = (top: Rgba, under: Rgba): Rgba => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1) as Rgba;

/** Background behind an element: its own and its ancestors' background colours, innermost first, over the white canvas. */
export function effectiveBg(layers: string[]): Rgba {
  const stack: Rgba[] = [];
  for (const l of layers) {
    const c = parseColor(l);
    if (!c || c[3] === 0) continue;
    stack.push(c);
    if (c[3] >= 1) break;
  }
  return stack.reduceRight<Rgba>((under, top) => over(top, under), [255, 255, 255, 1]);
}

/** WCAG 2 relative luminance and contrast ratio (fg alpha blended over bg). */
export function luminance([r, g, b]: Rgba): number {
  const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const a = luminance(over(fg, bg)), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
/** AA minimum: 3 for large text (24px+, or 18.66px+ bold), else 4.5. */
export const minContrast = (px: number, bold: boolean) => (px >= 24 || (bold && px >= 18.66) ? 3 : 4.5);

/** Page wider than the viewport = sideways scrolling (1px slack for sub-pixel rounding). */
export const overflowsX = (scrollWidth: number, viewport: number) => scrollWidth > viewport + 1;

/** What the page script measures at one viewport (see workspace-check.ts). bgLayers null = sits on a background image (unknown).
 *  clipX = html or body has overflow-x hidden/clip, so a wide child can't scroll the page sideways. */
export type TextSample = { fg: string; bgLayers: string[] | null; px: number; bold: boolean; text: string };
export type Probe = { vw: number; clipX?: boolean; scrollWidth: number; textLen: number; media: number; badImgs: string[]; samples: TextSample[] };

const hex = (c: Rgba) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
/** Text samples below the AA minimum, worst first. */
export function contrastIssues(samples: TextSample[]): string[] {
  const bad: { r: number; s: string }[] = [];
  for (const s of samples) {
    const fg = parseColor(s.fg);
    if (!fg || !s.bgLayers || s.bgLayers.some((l) => !parseColor(l))) continue; // unknown colour (color(), oklch…): can't judge
    const bg = effectiveBg(s.bgLayers), r = contrastRatio(fg, bg);
    if (r < minContrast(s.px, s.bold)) bad.push({ r, s: `low contrast ${r.toFixed(1)}:1 (needs ${minContrast(s.px, s.bold)}) on "${s.text.slice(0, 40)}" (${hex(over(fg, bg))} on ${hex(bg)})` });
  }
  return bad.sort((a, b) => a.r - b.r).map((b) => b.s);
}

export type CheckReport = { at: string; rendered: boolean; line: string; issues: string[]; shots: string[] };

/** The whole verdict from static issues, runtime errors and the two viewport probes (absent when no browser ran). */
export function summarize(input: { statics: string[]; errors: string[]; missing: string[]; desktop?: Probe; phone?: Probe; rendered?: boolean }): { line: string; issues: string[] } {
  const { desktop, phone } = input;
  const loads = [...input.errors.map((e) => `error: ${e.slice(0, 200)}`), ...input.missing.map((m) => `missing file: ${m} (404)`)];
  const staticSet = new Set(input.statics);
  for (const p of [desktop, phone]) if (p && !p.textLen && !p.media && !staticSet.has("page is blank (no text or media)")) loads.push("page is blank (no visible text or media)");
  const overflow = (p: Probe | undefined, name: string) => p && !p.clipX && overflowsX(p.scrollWidth, p.vw) ? [`${name}: page is ${p.scrollWidth}px wide at ${p.vw}px (sideways scroll)`] : [];
  const phoneIssues = overflow(phone, "phone"), deskIssues = overflow(desktop, "desktop");
  const imgs = [...new Set([...(desktop?.badImgs ?? []), ...(phone?.badImgs ?? [])])].map((s) => `image has no size or didn't load: ${s.slice(0, 120)}`);
  const contrast = [...new Set([...contrastIssues(desktop?.samples ?? []), ...contrastIssues(phone?.samples ?? [])])];
  const statics = input.statics.filter((s) => !input.missing.some((m) => s.startsWith(`missing file: ${m} `)));
  const loadIssues = [...new Set([...statics.filter((s) => s !== "no <title>"), ...loads])];
  const issues = [...loadIssues, ...(statics.includes("no <title>") ? ["no <title>"] : []), ...phoneIssues, ...deskIssues, ...imgs, ...contrast.slice(0, 5)];
  const mark = (ok: boolean, good: string, bad: string) => (ok ? `✓ ${good}` : `✗ ${bad}`);
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
  const parts = [mark(!loadIssues.length, "loads", n(loadIssues.length, "load problem"))];
  if (phone) parts.push(mark(!phoneIssues.length, "phone", "phone overflow"));
  if (desktop) parts.push(mark(!deskIssues.length, "desktop", "desktop overflow"));
  if (imgs.length) parts.push(`✗ ${n(imgs.length, "broken image")}`);
  if (contrast.length) parts.push(`✗ ${n(contrast.length, "contrast warning")}`);
  if (statics.includes("no <title>")) parts.push("✗ no title");
  if (!desktop && !phone) parts.push(input.rendered ? "✗ page didn't render" : "(static check only: no headless browser)");
  return { line: `checked: ${parts.join(", ")}`, issues };
}
