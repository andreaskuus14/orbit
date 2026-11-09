// W02 export QA (pure): the verdicts for an exported site from its HTML and what the browser measured at 360/390/768/1440 px:
// overflow, heading order, alt text, contrast (incl. the hero scrim's worst case), keyboard reach + visible focus, broken
// relative links/assets, metadata, the form with its fake receiver and the hero crop. The browser side is site-qa.ts.
// Tests: tests/site-qa.test.ts (with a deliberately broken page as the failing control).
import { type Asset, HERO_SCRIM, focalInBox } from "./site-brief-pure.ts";
import { type Probe, type Rgba, contrastIssues, contrastRatio, localRefs, minContrast, overflowsX } from "./workspace-check-pure.ts";

export const QA_VIEWPORTS = [{ width: 360, height: 780 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }] as const;

const strip = (h: string) => h.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
const attr = (tag: string, a: string) => new RegExp(`\\s${a}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(1).find((x) => x !== undefined);

/** One h1, and no level skipped on the way down (h2 → h4). */
export function headingIssues(html: string): string[] {
  const levels = [...strip(html).matchAll(/<h([1-6])\b/gi)].map((m) => +m[1]), out: string[] = [];
  const h1 = levels.filter((l) => l === 1).length;
  if (h1 !== 1) out.push(`${h1} <h1> elements (want exactly one)`);
  levels.forEach((l, i) => { if (i && l > levels[i - 1] + 1) out.push(`heading jumps from h${levels[i - 1]} to h${l}`); });
  if (levels[0] && levels[0] !== 1) out.push(`first heading is h${levels[0]}, not h1`);
  return out;
}

/** Every <img> has alt; a non-empty alt that is a file name or a placeholder word says nothing. */
export function altIssues(html: string): string[] {
  return [...strip(html).matchAll(/<img\b[^>]*>/gi)].flatMap((m) => {
    const alt = attr(m[0], "alt"), src = attr(m[0], "src") ?? "(no src)";
    if (alt === undefined) return [`<img src="${src}"> has no alt`];
    if (/\.(?:jpe?g|png|webp|svg|gif)$/i.test(alt.trim()) || /^(?:image|photo|picture|img|hero|banner)\s*\d*$/i.test(alt.trim())) return [`<img src="${src}"> alt "${alt}" doesn't describe the picture`];
    return [];
  });
}

/** Title, description, lang, charset, viewport, social preview tags and an icon. */
export function metaIssues(html: string): string[] {
  const out: string[] = [], head = /<head\b[\s\S]*?<\/head>/i.exec(html)?.[0] ?? "";
  const meta = (k: string) => [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => attr(t, "name") === k || attr(t, "property") === k);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1].trim() ?? "";
  if (!title) out.push("no <title>"); else if (title.length > 65) out.push(`<title> is ${title.length} characters (search results cut it after ~60)`);
  const d = meta("description"), dl = d ? (attr(d, "content") ?? "").trim().length : 0;
  if (!d) out.push("no meta description"); else if (dl < 50 || dl > 160) out.push(`meta description is ${dl} characters (aim for 50-160)`);
  if (!/<html\b[^>]*\slang\s*=\s*["']?[a-z]/i.test(html)) out.push("<html> has no lang");
  if (!/<meta\b[^>]*charset/i.test(head)) out.push("no <meta charset>");
  if (!meta("viewport")) out.push("no viewport meta");
  for (const k of ["og:title", "og:description", "og:image"]) if (!meta(k)) out.push(`no ${k}`);
  if (!/<link\b[^>]*rel\s*=\s*["']?(?:shortcut )?icon/i.test(head)) out.push("no favicon");
  return out;
}

/** Relative resources and links that point at nothing: missing files, root paths, and #anchors with no matching id. */
export function linkIssues(html: string, page: string, files: Set<string>): string[] {
  const out: string[] = [], body = strip(html), ids = new Set([...body.matchAll(/\sid\s*=\s*["']?([^"'\s>]+)/gi)].map((m) => m[1]));
  for (const r of localRefs(html, page)) {
    if (r.startsWith("/")) out.push(`root path ${r} breaks when the folder is opened from disk or a sub-path: make it relative`);
    else if (!files.has(r)) out.push(`missing file: ${r}`);
  }
  const dir = page.split("/").slice(0, -1);
  for (const m of body.matchAll(/<a\b[^>]*>/gi)) {
    const href = attr(m[0], "href");
    if (href === undefined) continue;
    if (href.startsWith("#")) { if (href.length > 1 && !ids.has(decodeURIComponent(href.slice(1)))) out.push(`link ${href} has no target id on the page`); continue; }
    if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) continue; // https:, mailto:, tel:
    const p = href.replace(/[?#].*$/, "");
    if (p.startsWith("/")) { out.push(`link ${href} is a root path: make it relative`); continue; }
    const parts = [...dir];
    for (const seg of p.split("/")) { if (seg === "..") parts.pop(); else if (seg && seg !== ".") parts.push(seg); }
    const target = parts.join("/") || "index.html";
    if (!files.has(target) && !files.has(`${target.replace(/\/$/, "")}/index.html`)) out.push(`link ${href} points at a missing file`);
  }
  return [...new Set(out)];
}

/** The lowest contrast text over a translucent scrim can have, whatever image is under it (black and white are the extremes). */
export function scrimContrast(fg: Rgba, scrim: Rgba): number {
  const over = (under: number): Rgba => [0, 1, 2].map((i) => scrim[i] * scrim[3] + under * (1 - scrim[3])).concat(1) as Rgba;
  return Math.min(contrastRatio(fg, over(0)), contrastRatio(fg, over(255)));
}

/** What the browser measured besides the standard probe: keyboard walk and the hero crop. */
export type KeyboardRun = { focusables: string[]; reached: string[]; noFocusStyle: string[]; clickOnly?: string[] }; // clickOnly: click handlers on things Tab can't reach
export type HeroRun = { boxW: number; boxH: number; posX: number; posY: number; copy: [number, number] | null } | null; // copy: text column [left, right] as fractions of the image box when it sits over the image
export type FormRun = { emptyBlocked: boolean; invalid: number; summary: boolean; focusOnError: boolean; accepted: boolean; received: number; status: string; badEmailBlocked: boolean };
export type ViewRun = { vw: number; probe: Probe; keyboard: KeyboardRun; hero: HeroRun; shot: string };
export type QaCheck = { name: string; ok: boolean; notes: string[] };
export type QaPacket = { pass: boolean; version: string; checks: QaCheck[]; viewports: { vw: number; shot: string; ok: boolean }[] };

export function keyboardIssues(k: KeyboardRun): string[] {
  const reached = new Set(k.reached);
  return [...k.focusables.filter((f) => !reached.has(f)).map((f) => `can't reach ${f} with Tab`), ...k.noFocusStyle.map((f) => `${f} shows no focus outline`), ...(k.clickOnly ?? []).map((f) => `${f} reacts to clicks but not the keyboard (use a <button>)`)];
}
/** The subject in view at every width, and clear of the desktop text column. */
export function heroIssues(h: HeroRun, a: Asset | undefined, vw: number): string[] {
  if (!h || !a) return [];
  const f = focalInBox(a, h.boxW / h.boxH, { x: h.posX, y: h.posY }), out: string[] = [];
  if (f.x < 0.05 || f.x > 0.95 || f.y < 0.05 || f.y > 0.95) out.push(`${vw}px: hero subject is cropped off (lands at ${(f.x * 100).toFixed(0)}%, ${(f.y * 100).toFixed(0)}%)`);
  if (h.copy && f.x > h.copy[0] - 0.03 && f.x < h.copy[1] + 0.03) out.push(`${vw}px: hero subject sits under the text (at ${(f.x * 100).toFixed(0)}% of the width)`);
  return out;
}
export function formIssues(f: FormRun | null): string[] {
  if (!f) return ["no form found to test"];
  const out: string[] = [];
  if (!f.emptyBlocked) out.push("an empty form was accepted");
  if (f.invalid < 3) out.push(`empty submit marked ${f.invalid} of 3 required fields invalid`);
  if (!f.summary) out.push("no error summary announced");
  if (!f.focusOnError) out.push("focus didn't move to the first field with an error");
  if (!f.badEmailBlocked) out.push("a malformed email was accepted");
  if (!f.accepted) out.push("a valid entry was not accepted");
  if (f.received !== 1) out.push(`fake receiver got ${f.received} entries (want exactly 1)`);
  if (f.accepted && !/thanks/i.test(f.status)) out.push("no visible confirmation after a valid entry");
  return out;
}

export function qaPacket(input: { html: string; page?: string; files: Set<string>; version: string; hero?: Asset; heroText?: Rgba[]; views: ViewRun[]; form: FormRun | null; art?: string[] }): QaPacket {
  const page = input.page ?? "index.html", v = input.views;
  const per = (f: (r: ViewRun) => string[]) => [...new Set(v.flatMap(f))];
  const overflow = (r: ViewRun) => (!r.probe.clipX && overflowsX(r.probe.scrollWidth, r.vw) ? [`${r.vw}px: page is ${r.probe.scrollWidth}px wide (sideways scroll)`] : []);
  const contrast = (r: ViewRun) => contrastIssues(r.probe.samples).map((s) => `${r.vw}px: ${s}`);
  const imgs = (r: ViewRun) => r.probe.badImgs.map((s) => `${r.vw}px: image didn't load: ${s}`);
  // only when a hero photo sits under the text (no hero image: the text is on the page's own background, covered by the contrast samples)
  const scrim = (input.hero ? input.heroText ?? [] : []).flatMap((c) => { const r = scrimContrast(c, HERO_SCRIM); return r < minContrast(17, false) ? [`hero text over the scrim can fall to ${r.toFixed(1)}:1 on a bright image`] : []; });
  const checks: QaCheck[] = [
    { name: "No sideways scroll", ok: false, notes: per(overflow) },
    { name: "Heading order", ok: false, notes: headingIssues(input.html) },
    { name: "Alt text", ok: false, notes: altIssues(input.html) },
    { name: "Contrast", ok: false, notes: [...per(contrast), ...scrim] },
    { name: "Keyboard", ok: false, notes: per((r) => keyboardIssues(r.keyboard).map((s) => `${r.vw}px: ${s}`)) },
    { name: "Links and assets", ok: false, notes: [...linkIssues(input.html, page, input.files), ...per(imgs)] },
    { name: "Metadata", ok: false, notes: metaIssues(input.html) },
    { name: "Hero crop", ok: false, notes: per((r) => heroIssues(r.hero, input.hero, r.vw)) },
    { name: "Form", ok: false, notes: formIssues(input.form) },
  ].map((c) => ({ ...c, ok: !c.notes.length }));
  // Art (the owner's cinematic standard, site-guide.ts): stand-in pictures or a choppy sequence mean "not finished", whatever else passes
  if (input.art) checks.push({ name: "Art (finished, not demo)", ok: !input.art.length, notes: input.art });
  if (!v.length) checks.push({ name: "Rendered", ok: false, notes: ["no browser ran: viewport, contrast and keyboard checks did not happen"] });
  const viewports = v.map((r) => ({ vw: r.vw, shot: r.shot, ok: !overflow(r).length && !imgs(r).length && !contrast(r).length && !keyboardIssues(r.keyboard).length }));
  return { pass: checks.every((c) => c.ok), version: input.version, checks, viewports };
}

export function qaMarkdown(p: QaPacket): string {
  return `# QA report (site version ${p.version}): ${p.pass ? "PASS" : "FAIL"}

| Check | Result |
|---|---|
${p.checks.map((c) => `| ${c.name} | ${c.ok ? "pass" : `**fail**: ${c.notes.slice(0, 6).join("; ").replace(/\|/g, "/")}${c.notes.length > 6 ? ` (+${c.notes.length - 6} more)` : ""}`} |`).join("\n")}

## Viewports
${p.viewports.map((x) => `- ${x.vw}px: ${x.ok ? "ok" : "problems (see above)"}, screenshot \`${x.shot}\``).join("\n") || "- none rendered"}

Checked with headless Chromium from the exported files (file://, every network request blocked). Not checked: real phones, screen readers, other browsers.
`;
}
