// CORE's multi-step site pipeline (owner: "maybe it doesn't need to complete the website in one step"): plan → layout/CSS → pages →
// licensed images → headless check + lint. Pure: license whitelist, image-API parsing, CREDITS.md, lint, step plan.
// Tests in tests/site-pipeline.test.ts; the network/disk side is site-images.ts and core-workspace.ts.
import { contrastRatio, type Rgba } from "./workspace-check-pure.ts";

// ---- Licenses: only these may be downloaded. NC (no commercial use) and ND (no changes; we resize) are refused.
export type License = { label: string; attribution: boolean };
/** A reuse-safe license from an API's license name/code ("CC BY-SA 4.0", "by-sa", "cc0", "Public domain", "pdm"), else null. */
export function licenseOk(name: unknown, version = ""): License | null {
  if (typeof name !== "string") return null;
  const n = name.toLowerCase().replace(/creative commons/g, "cc").replace(/[-_\s]+/g, " ").trim();
  if (/\b(?:nc|nd)\b|non ?commercial|no ?deriv/.test(n)) return null;
  if (/^(?:cc ?0|cc zero)\b/.test(n)) return { label: "CC0", attribution: false };
  if (/^(?:pdm|public domain|pd)\b/.test(n)) return { label: "Public domain", attribution: false };
  const m = /^(?:cc )?by(?: (sa))?(?: ([\d.]+))?$/.exec(n);
  return m ? { label: `CC BY${m[1] ? "-SA" : ""}${m[2] || version ? ` ${m[2] || version}` : ""}`, attribution: true } : null;
}

// ---- Image search results from the two public APIs, normalised.
export type Candidate = { url: string; title: string; author: string; license: License; source: string; via: "Wikimedia Commons" | "Openverse" | "Owner-supplied" };
const IMG_MIME = /^image\/(?:jpeg|png|webp|svg\+xml)$/;
const IMG_EXT = /\.(?:jpe?g|png|webp|svg)(?:$|\?)/i;
const text = (v: unknown, max = 120) => (typeof v === "string" ? v.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** MediaWiki API (generator=search, prop=imageinfo, iiprop=url|mime|extmetadata, iiurlwidth) → candidates with a whitelisted license. */
export function parseCommons(json: unknown): Candidate[] {
  const pages = Object.values(((json as { query?: { pages?: Record<string, unknown> } })?.query?.pages) ?? {}) as { title?: string; index?: number; imageinfo?: Record<string, unknown>[] }[];
  return pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).flatMap((p) => {
    const ii = p.imageinfo?.[0] as { thumburl?: string; url?: string; mime?: string; descriptionurl?: string; extmetadata?: Record<string, { value?: string }> } | undefined;
    const meta = ii?.extmetadata ?? {};
    const license = licenseOk(text(meta.LicenseShortName?.value));
    const url = ii?.thumburl || ii?.url;
    if (!ii || !license || !url || !IMG_MIME.test(ii.mime ?? "") || !/^https:\/\/upload\.wikimedia\.org\//.test(url)) return [];
    return [{ url, title: text(p.title).replace(/^File:/, "").replace(/\.\w+$/, ""), author: text(meta.Artist?.value) || "Unknown author", license, source: ii.descriptionurl ?? "", via: "Wikimedia Commons" as const }];
  });
}

/** Openverse /v1/images/ results → candidates with a whitelisted license. */
export function parseOpenverse(json: unknown): Candidate[] {
  const rows = ((json as { results?: unknown[] })?.results ?? []) as { url?: string; title?: string; creator?: string; license?: string; license_version?: string; foreign_landing_url?: string; filetype?: string }[];
  return rows.flatMap((r) => {
    const license = licenseOk(r.license, r.license_version ?? "");
    if (!license || typeof r.url !== "string" || !/^https:\/\//.test(r.url) || !(IMG_EXT.test(r.url) || /^(?:jpe?g|png|webp|svg)$/i.test(r.filetype ?? ""))) return [];
    return [{ url: r.url, title: text(r.title) || "Untitled", author: text(r.creator) || "Unknown author", license, source: r.foreign_landing_url ?? "", via: "Openverse" as const }];
  });
}

/** A direct URL is allowed only when the owner typed that exact URL in his own message. */
export const ownerSupplied = (url: string, question: string) => /^https:\/\//.test(url) && question.includes(url);

// ---- Downloaded bytes.
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // download limit
export const IMAGE_BUDGET = 350 * 1024; // per image on the finished site (lint)
/** Type from the file's magic bytes (never from the server's header), or null. */
export function sniffImage(b: Uint8Array): "jpg" | "png" | "webp" | "svg" | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "webp";
  const head = new TextDecoder().decode(b.slice(0, 1024)).replace(/^﻿/, "").trimStart();
  return /^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE svg[^>]*>\s*)?<svg\b/i.test(head) ? "svg" : null;
}
/** SVG that could run code or load outside things when opened as a page. */
export const unsafeSvg = (svg: string) => /<script\b|<foreignObject\b|\son[a-z]+\s*=|javascript:|(?:href|src)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(svg);

/** assets/<slug of purpose or query>.<ext> */
export function assetPath(name: string, ext: string): string {
  const slug = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "image";
  return `assets/${slug}.${ext}`;
}

// ---- assets/CREDITS.md: one line per asset, the last write of a path wins.
export type Credit = { path: string; title: string; author: string; license: string; attribution: boolean; source: string; via: string };
const LINE = /^- `([^`]+)` — (.*) by (.*) \((.*)\), (.*?) <(.*)>(?: · attribution required)?$/;
export function parseCredits(md: string): Credit[] {
  return md.split("\n").flatMap((l) => { const m = LINE.exec(l.trim()); return m ? [{ path: m[1], title: m[2], author: m[3], license: m[4], via: m[5], source: m[6], attribution: l.includes("attribution required") }] : []; });
}
const clean = (s: string) => s.replace(/[`<>\n()]/g, "").trim();
export function creditsMd(list: Credit[], add?: Credit): string {
  const all = add ? [...list.filter((c) => c.path !== add.path), add] : list;
  return `# Image credits\n\nImages in this site and their licenses (written by ORBIT when it downloaded them).\n\n${all.map((c) =>
    `- \`${c.path}\` — ${clean(c.title)} by ${clean(c.author)} (${clean(c.license)}), ${clean(c.via)} <${clean(c.source)}>${c.attribution ? " · attribution required" : ""}`).join("\n")}\n`;
}
/** The footer line for licenses that require attribution ("" when none do). */
export function attributionLine(list: Credit[]): string {
  const need = list.filter((c) => c.attribution);
  return need.length ? `Images: ${need.map((c) => `“${clean(c.title)}” by ${clean(c.author)} (${clean(c.license)}, ${clean(c.via)})`).join("; ")}.` : "";
}

// ---- Lint: static checks on the written files; issues feed the fix rounds next to the headless check's.
const NAMED: Record<string, string> = { white: "#fff", black: "#000", red: "#f00", gray: "#808080", grey: "#808080", silver: "#c0c0c0", navy: "#000080", blue: "#00f", green: "#008000", yellow: "#ff0", orange: "#ffa500", purple: "#800080", teal: "#008080", maroon: "#800000" };
/** #rgb, #rrggbb, rgb()/rgba() or a basic named colour → Rgba; null for vars, gradients and anything else. */
export function cssColor(v: string): Rgba | null {
  const s = (NAMED[v.trim().toLowerCase()] ?? v).trim();
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)?.[1];
  if (h) { const x = h.length === 3 ? h.replace(/./g, "$&$&") : h; return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)).concat(1) as Rgba; }
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(s);
  return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : Math.min(1, +m[4] / (m[5] ? 100 : 1))] : null;
}
/** Rules that set both a text colour and a solid background: pairs under 4.5:1. CSS custom properties are resolved from :root. */
export function cssContrast(css: string): string[] {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const vars = new Map([...body.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)].map((m) => [m[1], m[2].trim()]));
  const val = (v: string) => v.replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, (_, n, d) => vars.get(n) ?? d ?? "").trim();
  const out: string[] = [];
  for (const [, sel, decl] of body.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const fg = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(decl)?.[1], bg = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i.exec(decl)?.[1];
    const f = fg && cssColor(val(fg)), b = bg && cssColor(val(bg));
    if (!f || !b || b[3] < 1) continue;
    const r = contrastRatio(f, b);
    if (r < 4.5) out.push(`low contrast ${r.toFixed(2)}:1 in "${sel.trim().slice(0, 60)}" (${val(fg!)} on ${val(bg!)}); make it at least 4.5:1`);
  }
  return out;
}
export type SiteFiles = { html: { path: string; text: string }[]; css: { path: string; text: string }[]; images: { path: string; bytes: number }[]; credits?: string };
export function lintSite(f: SiteFiles): string[] {
  const out: string[] = [];
  for (const { path, text: h } of f.html) {
    if (!/<meta[^>]+name=["']?viewport/i.test(h)) out.push(`${path}: missing <meta name="viewport" content="width=device-width, initial-scale=1">`);
    if (!/<html[^>]*\blang=/i.test(h)) out.push(`${path}: <html> has no lang attribute`);
    const noAlt = [...h.matchAll(/<img\b[^>]*>/gi)].filter((m) => !/\salt\s*=/i.test(m[0])).length;
    if (noAlt) out.push(`${path}: ${noAlt} <img> without alt text (alt="" only for decoration)`);
    if (/<(?:link|script)\b[^>]*(?:href|src)\s*=\s*["']?(?:https?:)?\/\//i.test(h) || /@import\s+url\(\s*["']?https?:/i.test(h)) out.push(`${path}: loads an external font/CDN; the preview is offline, use system fonts and local files`);
    for (const m of h.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) out.push(...cssContrast(m[1]).map((i) => `${path}: ${i}`));
  }
  for (const { path, text: c } of f.css) {
    out.push(...cssContrast(c).map((i) => `${path}: ${i}`));
    if (/@import\s+url\(\s*["']?https?:|@font-face[^}]*url\(\s*["']?https?:/i.test(c)) out.push(`${path}: loads an external font; use a system font stack`);
  }
  for (const i of f.images) if (i.bytes > IMAGE_BUDGET) out.push(`${i.path} is ${Math.round(i.bytes / 1024)} KB (budget ${IMAGE_BUDGET / 1024} KB): fetch a smaller one or drop it`);
  const need = attributionLine(parseCredits(f.credits ?? ""));
  const all = f.html.map((h) => h.text.replace(/<[^>]*>/g, " ")).join(" ");
  for (const c of parseCredits(f.credits ?? "").filter((c) => c.attribution)) if (!all.includes(clean(c.author))) { out.push(`footer is missing the required image credit; add: ${need}`); break; }
  return [...out, ...lintCraft(f)];
}

// ---- Craft lint (owner's website rules): invented proof, AI-look tells, CSS discipline. Each issue says what to do instead.
const rules = (css: string) => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), decl: m[2] }));
const COLOR_LIT = /(?<!url\(\s*["']?)#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/i;
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/u; // not text-style symbols such as © ® ™
/** Owner-marked blocks (data-proof="owner", data-slot, data-owner) removed: his own text and proof aren't linted as invented or too long. */
const unowned = (h: string) => h.replace(/<([a-z][a-z0-9]*)\b[^>]*\bdata-(?:proof\s*=\s*["']?owner|slot\s*=|owner\b)[^>]*>[\s\S]*?<\/\1>/gi, " ");
export function lintCraft(f: SiteFiles): string[] {
  const out: string[] = [];
  const css = [...f.css.map((c) => c.text), ...f.html.flatMap((h) => [...h.text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]))].join("\n");
  const rs = rules(css), outside = rs.filter((r) => !/^:root\b/.test(r.sel) && !/^(?:from|to|\d+%)/.test(r.sel));
  for (const { path, text: h } of f.html) {
    const body = h.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ");
    const quotes = [...body.matchAll(/<(blockquote|q)\b[^>]*>|<[a-z]+\b[^>]*\b(?:class|id)\s*=\s*["'][^"']*\b(?:reviews?|testimonials?|ratings?|stars)\b[^>]*>/gi)];
    if (quotes.some((m) => !/data-proof\s*=\s*["']?owner|data-slot\s*=/i.test(m[0])) || /★|⭐/.test(unowned(body)))
      out.push(`${path}: a review/quote block not marked as the owner's: never invent reviews, names or numbers; use proof the owner gave (data-proof="owner") or a marked slot (data-slot="proof")`);
    if (/\b(?:class|id)\s*=\s*["'][^"']*\b(?:eyebrow|kicker|overline|pretitle)\b/i.test(body)) out.push(`${path}: eyebrow/kicker label above a heading; let the heading stand alone`);
    if (/>\s*0[1-9]\s*[.:/—–-]?\s*<\/[a-z0-9]+>\s*<h[1-6]\b|<h[1-6]\b[^>]*>\s*(?:<[a-z]+\b[^>]*>\s*)?0[1-9]\b/i.test(body)) out.push(`${path}: 01/02/03-style section numbers; drop them`); // next to a heading only: not a table cell or a time
    if (EMOJI.test(visible(h))) out.push(`${path}: emoji used as icons or decoration; draw a small inline SVG icon instead`);
    const reveals = (body.match(/<[a-z]+\b[^>]*(?:\bclass\s*=\s*["'][^"']*\b(?:reveal|fade-?in|fade-?up|animate-on-scroll)\b|\bdata-(?:reveal|aos)\b)/gi) ?? []).length;
    if (reveals > 1) out.push(`${path}: ${reveals} reveal-on-scroll elements; keep one authored moment and leave the rest visible`);
  }
  const js = f.html.map((h) => h.text).join("\n") + ((f as { js?: { text: string }[] }).js ?? []).map((j) => j.text).join("\n");
  if (/querySelectorAll\(\s*["'`][^"'`]*\bsection\b[^)]*\)[\s\S]{0,300}observe\(/.test(js)) out.push("reveal-on-scroll is applied to every section; keep one authored moment and leave the rest visible");
  if (!css.trim()) return out;
  const hidden = rs.find((r) => /reveal|fade|aos|animate/i.test(r.sel) && !/\.in\b|\.is-|\.visible|\.shown|\.js\b|\.active/i.test(r.sel) && /(?:^|;)\s*(?:opacity\s*:\s*0(?:\.0*)?\s*(?:;|$)|visibility\s*:\s*hidden)/i.test(r.decl));
  if (hidden) out.push(`"${hidden.sel.slice(0, 60)}" hides content until a script reveals it; content must be visible by default (hide it only under a class the script adds)`);
  const lit = outside.find((r) => r.decl.split(";").some((d) => /^\s*--/.test(d) ? false : COLOR_LIT.test(d)));
  if (lit) out.push(`"${lit.sel.slice(0, 60)}" uses a literal colour; define colours once as :root custom properties and use var(--…)`);
  const font = outside.find((r) => /(?:^|;)\s*font-family\s*:\s*(?!\s*(?:var\(|inherit\b|initial\b|unset\b))/i.test(r.decl));
  if (font) out.push(`"${font.sel.slice(0, 60)}" sets a font stack directly; define fonts as :root custom properties and use var(--…)`);
  if (/transition(?:-property)?\s*:\s*all\b/i.test(css)) out.push("transition: all; name the properties (transform, opacity)");
  const layoutAnim = /transition(?:-property)?\s*:[^;}]*(?<![\w-])(?:width|height|top|left)\b/i.test(css) || [...css.matchAll(/@keyframes[^{]*\{((?:[^{}]*\{[^{}]*\})*)/gi)].some((m) => /(?:^|[;{\s])(?:width|height|top|left)\s*:/i.test(m[1]));
  if (layoutAnim) out.push("animates width/height/top/left (janky layout work); animate transform and opacity instead");
  const clip = (el: string) => rs.some((r) => r.sel.split(",").some((x) => x.trim() === el) && /overflow-x\s*:\s*clip/i.test(r.decl));
  if (!clip("html") || !clip("body")) out.push("set overflow-x: clip on html and body (no sideways scroll)");
  if (!/:focus-visible/.test(css)) out.push("no :focus-visible style; give every control a visible keyboard focus ring");
  if (!/::selection/.test(css)) out.push("no ::selection style; colour the text selection from the palette");
  if (rs.some((r) => /(?:-webkit-)?background-clip\s*:\s*text|text-fill-color\s*:\s*transparent/i.test(r.decl))) out.push("gradient text; use a solid colour from the palette");
  const tracked = rs.find((r) => /text-transform\s*:\s*uppercase/i.test(r.decl) && /letter-spacing\s*:\s*(?:0?\.\d*[1-9]|[1-9])/i.test(r.decl));
  if (tracked) out.push(`"${tracked.sel.slice(0, 60)}" is a tracked-caps label; use sentence case headings instead`);
  return out;
}

// ---- Step plan: what the next step is, from the files already in the workspace (CORE's progress, and the next-step hint).
export type SiteStep = "plan" | "server" | "layout" | "pages" | "images" | "check";
export const SITE_STEPS: SiteStep[] = ["plan", "server", "layout", "pages", "images", "check"];
/** plan.md's "Type: fullstack" line (the plan step decides static vs fullstack). */
export const isFullstackPlan = (plan: string) => /^\W*type\W*:?\W*full-?stack\b/im.test(plan);
/** Where the front end lives: public/ in a full-stack workspace (server.mjs serves it; ws-server-pure.ts template), else the root. */
export const frontRoot = (plan: string) => (isFullstackPlan(plan) ? "public/" : "");
export function nextSiteStep(paths: string[], plan = ""): SiteStep {
  const root = frontRoot(plan);
  if (!paths.includes("plan.md")) return "plan";
  if (isFullstackPlan(plan) && !paths.includes("server.mjs")) return "server";
  if (!paths.some((p) => p.startsWith(root) && p.endsWith(".css"))) return "layout";
  if (!paths.includes(`${root}index.html`)) return "pages";
  if (!paths.some((p) => /\.(?:png|jpe?g|webp)$/i.test(p) || (p.startsWith("assets/") && !p.endsWith(".md")))) return "images";
  return "check";
}
const HINT: Record<SiteStep, string> = {
  plan: "write plan.md first (a \"Type: static\" or \"Type: fullstack\" line; audience, pages/sections, tone, palette, content outline, inspiration notes from web_search/fetch_url; for fullstack also the data model and API routes)",
  server: "create the back end with ws_create {\"name\": <this workspace>, \"template\": \"fullstack\"} (server.mjs, /api routes, data/ store, public/), then ws_write its routes and data model from plan.md and ws_run to start and smoke-check it",
  layout: "write the layout and CSS ({root}css/style.css) following the site guide",
  pages: "write the pages ({root}index.html last)",
  images: "the site has no photos yet: ws_picture_draft the realistic photos it needs at the paths the pages use (stand-ins appear at once, the owner approves the real ones in STUDIO → Websites), or ws_fetch_image licensed ones; draw inline SVG art for icons and section illustrations",
  check: "fix what the check and lint list, then deliver",
};
export const siteStepHint = (paths: string[], plan = "") => `Next site step: ${HINT[nextSiteStep(paths, plan)].replace(/\{root\}/g, frontRoot(plan))}.`;
/** i18n keys for the live progress labels of the pipeline's steps (CoreActivity translates them). */
export const SITE_LABEL_KEYS: Record<string, "site.plan" | "site.layout" | "site.pages" | "site.image" | "site.inspire"> = {
  "Writing the site plan…": "site.plan", "Writing layout and styles…": "site.layout", "Writing the pages…": "site.pages", "Finding a licensed image…": "site.image", "Gathering picture ideas…": "site.inspire",
};
/** Progress label of a ws_write in the pipeline, from the files it writes; null = the generic one. */
export function siteWriteLabel(files: unknown): string | null {
  const p = Array.isArray(files) ? files.map((f) => String((f as { path?: unknown })?.path ?? "")) : [];
  if (!p.length) return null;
  if (p.every((x) => x === "plan.md")) return "Writing the site plan…";
  if (p.every((x) => x.endsWith(".css"))) return "Writing layout and styles…";
  if (p.some((x) => x.endsWith(".html"))) return "Writing the pages…";
  return null;
}

// ---- Depth lint (owner: "built sites look like plain starter templates"): no pictures, thin text, a form that saves nothing,
// or a back end asked for but not built. Separate from lintSite so its basic rules stay testable on tiny pages.
/** Words budget (owner's website rules): about 80 visible words per screen (a section), at most about 450 per page, hero ≤7 words. */
export const WORDS_PER_SCREEN = 80, WORDS_PER_PAGE = 450, HERO_WORDS = 7;
/** The owner's request wants data saved (bookings, orders, accounts, a database or an admin). */
export const wantsBackend = (q: string) => /\b(?:back[- ]?end|database|\bdb\b|full[- ]?stack|admin (?:panel|page)|log ?in|sign ?up|accounts?|(?:that|which|to) saves?|stores? (?:the )?(?:bookings?|orders?|data)|booking system|api)\b|andmebaas|tagasüsteem|salvesta/i.test(q);
const visible = (h: string) => h.replace(/<(script|style|svg|noscript)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
type Depth = SiteFiles & { js?: { path: string; text: string }[]; fullstack?: boolean; wantsBackend?: boolean };

/** Pictures (img/picture/svg/canvas or a CSS url() background), visible text characters and forms across the pages. */
const words = (t: string) => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
/** Per page: over-budget words, sections over a screen's worth (+25% slack), and a long hero headline (the first <h1>). */
export function wordIssues(f: Depth): string[] {
  const out: string[] = [];
  for (const { path, text: h } of f.html) {
    const n = words(visible(unowned(h))); // text the owner supplied (data-owner) is never counted, so it's never asked to be cut
    if (n > WORDS_PER_PAGE * 1.1) out.push(`${path}: ${n} visible words you wrote (aim for at most about ${WORDS_PER_PAGE} per page): tighten your own copy; never cut text the owner gave (mark it data-owner)`);
    const long = [...unowned(h).matchAll(/<(section|header)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => words(visible(m[2]))).filter((w) => w > WORDS_PER_SCREEN * 1.25);
    if (long.length) out.push(`${path}: ${long.length} section${long.length > 1 ? "s" : ""} over about ${WORDS_PER_SCREEN} words (${long.join(", ")}): one screen, one idea`);
    const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(h)?.[1];
    if (h1 && words(visible(h1)) > HERO_WORDS) out.push(`${path}: hero headline has ${words(visible(h1))} words (at most ${HERO_WORDS})`);
  }
  return out;
}
export function siteFacts(f: Depth): { visuals: number; chars: number; forms: number; handled: boolean } {
  const html = f.html.map((h) => h.text).join("\n"), css = f.css.map((c) => c.text).join("\n"), js = [...(f.js ?? []).map((j) => j.text), ...[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1])].join("\n");
  const visuals = (html.match(/<(?:img|picture|svg|canvas|video)\b/gi) ?? []).length + (`${css}\n${html}`.match(/background(?:-image)?\s*:[^;}]*url\(/gi) ?? []).length;
  const forms = [...html.matchAll(/<form\b[^>]*>/gi)];
  const handled = forms.every((m) => /\saction\s*=\s*["']?[^"'\s>#]/i.test(m[0]) || /\sonsubmit\s*=/i.test(m[0])) || /addEventListener\(\s*["']submit["']|\.onsubmit\s*=|requestSubmit|fetch\(/.test(js);
  return { visuals, chars: f.html.reduce((n, h) => n + visible(h.text).length, 0), forms: forms.length, handled };
}
export function lintDepth(f: Depth): string[] {
  const x = siteFacts(f), out: string[] = [];
  if (!f.html.length) return out;
  if (!x.visuals) out.push("no pictures, SVG or illustration at all: draft real photos with ws_picture_draft (stand-ins appear at once), fetch licensed ones with ws_fetch_image, and draw inline SVG art for icons and section art");
  out.push(...wordIssues(f));
  if (x.forms && !x.handled) out.push("a <form> has no handler, so it saves nothing: give it a submit handler with a visible confirmation (and a fullstack back end when entries must be kept)");
  if (f.wantsBackend && !f.fullstack) out.push("the request needs saved data (bookings, orders, accounts or a database) but this is a static site: ws_create the \"fullstack\" template and move the front end to public/");
  return out;
}
/** The facts part of the Check line, so the answer's honest review has numbers. */
export const factsLine = (f: Depth) => { const x = siteFacts(f); return `${x.visuals} picture${x.visuals === 1 ? "" : "s"}/SVG, ${x.chars} chars of text${x.forms ? `, ${x.forms} form${x.forms > 1 ? "s" : ""}${x.handled ? "" : " (no handler)"}` : ""}`; };
