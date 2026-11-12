// W02 site brief (pure): one typed, editor-friendly brief (site.json in the workspace) → a versioned one-page site. Copy, brand,
// assets and section settings stay separate from rendering; sections keep stable IDs; copy edits never touch assets; the hero
// crop follows a focal point and keeps a text-safe area. Disk side: site-brief.ts. Tests: tests/site-brief.test.ts.
import { DIRECTIONS, IMMERSIVE_CSS, IMMERSIVE_JS, SCENE_CSS, SCENE_JS, SEQUENCE_CSS, SEQUENCE_JS, accentHeading, directionOf, framePath, keyFrames, sceneSection, sequenceSection } from "./site-immersive-pure.ts";

export type Focal = { x: number; y: number };
/** An image the site uses. focal = the subject (0-1 of width/height); safe = the side of the image with no subject, where text may sit. */
export type Asset = { id: string; path: string; alt: string; width: number; height: number; focal: Focal; safe: "left" | "right"; origin: string };
export type Item = { label?: string; title: string; body: string };
export type Link = { label: string; href: string };
export type Kind = "hero" | "features" | "story" | "specs" | "faq" | "form" | "sequence" | "scene";
/** A layered parallax scene: images back to front with a depth (0 = far, 1 = near), a giant word set between two of them. */
export type Scene3 = { layers: { path: string; depth: number }[]; word: string; wordAt: number; alt: string; poster?: string }; // poster: the flattened scene, for sharing
/** A scroll-scrubbed frame sequence (e.g. an ARCH Blender fly-through): files path with %03d, 1-based. */
export type Seq = { path: string; count: number; width: number; height: number; alt: string };
export type Section = { id: string; kind: Kind; heading: string; body: string[]; items: Item[]; image?: string; cta: Link[]; seq?: Seq; scene?: Scene3; ask?: { label: string; options: string[] } }; // ask: one optional multiple-choice question on a form
export type Brief = {
  version: number; style?: "classic" | "immersive" | "cinematic" | "daylight" | "editorial"; name: string; offer: string; audience: string; lang: string; description: string; tagline: string;
  assets: Asset[]; sections: Section[]; history: { version: number; changed: string[]; undo?: { section: string; image?: string } }[];
};
export type Parsed = { brief: Brief; missing: string[] } | { errors: string[] };

const KINDS: Kind[] = ["hero", "features", "story", "specs", "faq", "form", "sequence", "scene"];
const SEQ_PATH = /^(?!.*\.\.)(?:[a-z0-9][a-z0-9_-]*\/){0,3}[a-z0-9_-]*%03d[a-z0-9_-]*\.(?:jpe?g|webp|png)$/;
const ID = /^[a-z][a-z0-9-]{0,39}$/;
const ASSET_PATH = /^(?!.*\.\.)(?:[a-z0-9][a-z0-9_-]*\/){0,3}[a-z0-9][a-z0-9_-]*\.(?:jpe?g|png|webp|svg)$/;
const s = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const unit = (v: unknown, d: number) => (typeof v === "number" && v >= 0 && v <= 1 ? v : d);
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");

/** A sparse brief (name + offer, maybe one image) or a detailed one → a full Brief with stable section IDs, or every problem found.
 *  missing = essentials the owner should still be asked for (everything else gets a sensible default). */
export function parseBrief(input: unknown): Parsed {
  const i = obj(input), errors: string[] = [], missing: string[] = [];
  const name = s(i.name, 60), offer = s(i.offer, 300), audience = s(i.audience, 300);
  if (!name) errors.push("name is required (the brand or product name)");
  if (!offer) errors.push("offer is required (one sentence: what is offered to whom)");
  if (!audience) missing.push("audience");

  const assets: Asset[] = [];
  for (const [n, raw] of arr(i.assets).entries()) {
    const a = obj(raw), path = s(a.path, 80).toLowerCase().replace(/^\.\//, ""), id = s(a.id, 40) || slug(path.replace(/\.\w+$/, "").split("/").pop() ?? "");
    const alt = s(a.alt, 200), w = Number(a.width) || 0, h = Number(a.height) || 0, f = obj(a.focal);
    if (!ASSET_PATH.test(path)) { errors.push(`assets[${n}]: path must be a relative image like "assets/hero.jpg"`); continue; }
    if (!ID.test(id)) errors.push(`assets[${n}]: id "${id}" must be lowercase letters, digits and -`);
    if (assets.some((x) => x.id === id)) errors.push(`assets[${n}]: id "${id}" is used twice`);
    if (!alt) errors.push(`assets[${n}] (${path}): alt text is required`);
    if (!(w > 0 && h > 0)) errors.push(`assets[${n}] (${path}): width and height (px) are required, so the page doesn't jump while loading`);
    if (a.focal !== undefined && (unit(f.x, -1) < 0 || unit(f.y, -1) < 0)) errors.push(`assets[${n}] (${path}): focal x and y must be 0-1`);
    assets.push({ id, path, alt, width: w, height: h, focal: { x: unit(f.x, 0.5), y: unit(f.y, 0.5) }, safe: a.safe === "right" ? "right" : "left", origin: s(a.origin, 120) || "owner-supplied" });
  }

  const given = arr(i.sections);
  const rawSections = given.length ? given : [
    { kind: "hero", heading: name, body: [offer], image: assets[0]?.id, cta: [{ label: "Get in touch", href: "#contact" }] },
    { id: "contact", kind: "form", heading: `Hear from ${name}`, body: ["Leave your email and we will write when there is news."] },
  ];
  const sections: Section[] = [];
  for (const [n, raw] of rawSections.entries()) {
    const r = obj(raw), kind = r.kind as Kind;
    if (!KINDS.includes(kind)) { errors.push(`sections[${n}]: kind must be one of ${KINDS.join(", ")}`); continue; }
    let id = s(r.id, 40);
    if (!id) { id = kind; for (let k = 2; sections.some((x) => x.id === id); k++) id = `${kind}-${k}`; } // derived from order: stable while sections stay put
    if (!ID.test(id)) errors.push(`sections[${n}]: id "${id}" must be lowercase letters, digits and -`);
    else if (sections.some((x) => x.id === id)) errors.push(`sections[${n}]: id "${id}" is used twice`);
    const heading = s(r.heading, 120);
    if (!heading) errors.push(`sections[${n}] (${id}): heading is required`);
    const image = s(r.image, 40) || undefined;
    if (image && !assets.some((a) => a.id === image)) errors.push(`sections[${n}] (${id}): image "${image}" is not in assets`);
    const items = arr(r.items).slice(0, 12).map((x) => { const o = obj(x); return { ...(s(o.label, 24) ? { label: s(o.label, 24) } : {}), title: s(o.title, 120), body: s(o.body, 600) }; });
    if (items.some((x) => !x.title)) errors.push(`sections[${n}] (${id}): every item needs a title`);
    const cta = arr(r.cta).slice(0, 2).map((x) => ({ label: s(obj(x).label, 40), href: s(obj(x).href, 200) }));
    let scene: Scene3 | undefined;
    if (kind === "scene") {
      const q = obj(r.scene), layers = arr(q.layers).slice(0, 8).map((l) => { const o = obj(l); return { path: s(o.path, 80).toLowerCase(), depth: Number(o.depth) }; });
      if (layers.length < 2) errors.push(`sections[${n}] (${id}): scene needs 2-8 layers`);
      for (const l of layers) if (!ASSET_PATH.test(l.path) || !(l.depth >= 0 && l.depth <= 1)) errors.push(`sections[${n}] (${id}): layer "${l.path}" needs a relative image path and a depth 0-1`);
      const word = s(q.word, 24), wordAt = Math.floor(Number(q.wordAt ?? 1)), alt = s(q.alt, 200);
      if (!alt) errors.push(`sections[${n}] (${id}): scene.alt is required (what the scene shows)`);
      const poster = s(q.poster, 80).toLowerCase();
      if (poster && !ASSET_PATH.test(poster)) errors.push(`sections[${n}] (${id}): scene.poster must be a relative image path`);
      scene = { layers, word, wordAt: Math.min(Math.max(wordAt, 0), layers.length), alt, ...(poster ? { poster } : {}) };
    }
    let seq: Seq | undefined;
    if (kind === "sequence") {
      const q = obj(r.seq), path = s(q.path, 80).toLowerCase(), count = Math.floor(Number(q.count) || 0), w = Number(q.width) || 0, h = Number(q.height) || 0, alt = s(q.alt, 200);
      if (!SEQ_PATH.test(path)) errors.push(`sections[${n}] (${id}): seq.path must be a relative frame pattern like "seq/f%03d.jpg"`);
      if (!(count >= 2 && count <= 240)) errors.push(`sections[${n}] (${id}): seq.count must be 2-240 frames`);
      if (!(w > 0 && h > 0)) errors.push(`sections[${n}] (${id}): seq.width and seq.height (px) are required`);
      if (!alt) errors.push(`sections[${n}] (${id}): seq.alt is required (what the sequence shows)`);
      seq = { path, count, width: w, height: h, alt };
    }
    let ask: { label: string; options: string[] } | undefined;
    if (kind === "form" && r.ask !== undefined) {
      const q = obj(r.ask), label = s(q.label, 80), options = arr(q.options).map((o) => s(o, 60)).filter(Boolean).slice(0, 8);
      if (!label || options.length < 2) errors.push(`sections[${n}] (${id}): ask needs a label and 2-8 options`); else ask = { label, options };
    }
    sections.push({ id, kind, ...(seq ? { seq } : {}), ...(scene ? { scene } : {}), ...(ask ? { ask } : {}), heading, body: arr(r.body).map((p) => s(p, 1200)).filter(Boolean).slice(0, 6), items, ...(image ? { image } : {}), cta });
  }
  const ids = new Set(sections.map((x) => x.id));
  for (const x of sections) for (const c of x.cta) {
    if (!c.label) errors.push(`${x.id}: every button needs a label`);
    if (c.href.startsWith("#") ? !ids.has(c.href.slice(1)) : !/^(?:https:\/\/|mailto:)[^\s"<>]+$/.test(c.href)) errors.push(`${x.id}: link "${c.href}" must be #<section id>, https:// or mailto:`);
  }
  if (!sections.some((x) => x.kind === "hero")) errors.push("a hero section is required");
  if (sections.filter((x) => x.kind === "form").length > 1) errors.push("one form per page");
  if (errors.length) return { errors };
  const description = s(i.description, 160) || offer.slice(0, 160);
  return { brief: { version: Math.max(1, Math.floor(Number(i.version) || 1)), ...(directionOf(s(i.style, 20)) ? { style: s(i.style, 20) as Brief["style"] } : {}), name, offer, audience, lang: /^[a-z]{2}(?:-[A-Z]{2})?$/.test(s(i.lang, 5)) ? s(i.lang, 5) : "en", description, tagline: s(i.tagline, 80), assets, sections, history: arr(i.history) as Brief["history"] }, missing };
}

// ---- Copy edits: text only. A field path is "heading", "body.N", "items.N.title|body|label" or "cta.N.label" on a section, or
// "description"/"tagline" on the site. Images, alt text, hrefs and IDs are not copy, so an edit can never move or swap an asset.
export type CopyEdit = { section?: string; field: string; value: string };
export function editCopy(b: Brief, edits: CopyEdit[]): { brief: Brief; changed: string[] } | { error: string } {
  const next: Brief = JSON.parse(JSON.stringify(b)), changed: string[] = [];
  for (const e of edits) {
    const value = s(e.value, 1200);
    if (!value) return { error: `${e.section ?? "site"}.${e.field}: the new text is empty` };
    if (!e.section) {
      if (e.field !== "description" && e.field !== "tagline") return { error: `site field "${e.field}" is not copy (use description or tagline)` };
      next[e.field] = value.slice(0, e.field === "description" ? 160 : 80); changed.push(e.field); continue;
    }
    const sec = next.sections.find((x) => x.id === e.section);
    if (!sec) return { error: `no section "${e.section}"` };
    const [f, n, sub] = e.field.split(".") as [string, string?, string?], k = Number(n);
    if (f === "heading" && n === undefined) sec.heading = value.slice(0, 120);
    else if (f === "body" && Number.isInteger(k) && k >= 0 && k <= sec.body.length && sub === undefined) sec.body[k] = value;
    else if (f === "items" && sec.items[k] && (sub === "title" || sub === "body" || sub === "label")) sec.items[k][sub] = value.slice(0, sub === "label" ? 24 : sub === "title" ? 120 : 600);
    else if (f === "cta" && sec.cta[k] && sub === "label") sec.cta[k].label = value.slice(0, 40);
    else return { error: `${e.section}.${e.field} is not editable copy (images, alt text, links and IDs are changed in the brief's assets/sections, not as copy)` };
    changed.push(`${e.section}.${e.field}`);
  }
  next.version = b.version + 1;
  next.history = [...b.history, { version: next.version, changed }].slice(-50);
  return { brief: next, changed };
}

// ---- Image swap: a section's picture changes to another asset already in the brief (copy untouched), as its own version that
// remembers the previous picture, so undoImage() can put it back. Reversible without regenerating anything.
export function swapImage(b: Brief, section: string, asset: string): { brief: Brief } | { error: string } {
  const sec = b.sections.find((x) => x.id === section);
  if (!sec) return { error: `no section "${section}"` };
  if (!b.assets.some((a) => a.id === asset)) return { error: `asset "${asset}" is not in the brief (add it to assets first)` };
  if (sec.image === asset) return { error: `${section} already shows "${asset}"` };
  const next: Brief = JSON.parse(JSON.stringify(b)), version = b.version + 1;
  next.sections.find((x) => x.id === section)!.image = asset;
  next.version = version;
  next.history = [...b.history, { version, changed: [`${section}.image`], undo: { section, ...(sec.image ? { image: sec.image } : {}) } }].slice(-50);
  return { brief: next };
}
/** Puts back the picture the last swap replaced, as a new version (history only moves forward). */
export function undoImage(b: Brief): { brief: Brief } | { error: string } {
  const last = [...b.history].reverse().find((h) => h.undo);
  if (!last?.undo || b.history.at(-1) !== last) return { error: "the last change wasn't an image swap" };
  const next: Brief = JSON.parse(JSON.stringify(b)), sec = next.sections.find((x) => x.id === last.undo!.section);
  if (!sec) return { error: `no section "${last.undo.section}"` };
  if (last.undo.image) sec.image = last.undo.image; else delete sec.image;
  next.version = b.version + 1;
  next.history = [...b.history, { version: next.version, changed: [`${sec.id}.image (undo)`] }].slice(-50);
  return { brief: next };
}

// ---- Hero art direction: object-position that puts the focal point at `target` (0-1 across the box) for a cover crop.
/** Cover crop of an image (aspect w/h) into a box (aspect): object-position as fractions, clamped to the image's edges. */
export function cropPosition(img: { width: number; height: number; focal: Focal }, box: number, target: Focal = { x: 0.5, y: 0.5 }): Focal {
  const a = img.width / img.height, u = Math.min(1, box / a), v = Math.min(1, a / box); // visible fraction across / down
  const pos = (f: number, t: number, vis: number) => (vis >= 1 ? 0.5 : Math.max(0, Math.min(1, (f - t * vis) / (1 - vis))));
  return { x: pos(img.focal.x, target.x, u), y: pos(img.focal.y, target.y, v) };
}
/** Where the focal point lands in the box (0-1) for an object-position: lets QA prove the subject is in view and clear of the text. */
export function focalInBox(img: { width: number; height: number; focal: Focal }, box: number, p: Focal): Focal {
  const a = img.width / img.height, u = Math.min(1, box / a), v = Math.min(1, a / box);
  return { x: (img.focal.x - p.x * (1 - u)) / u, y: (img.focal.y - p.y * (1 - v)) / v };
}
/** The hero's crops: phone 4:5 and tablet 4:3 (text below the image), desktop full-bleed ~16:9 with the text over the safe side. */
export const HERO_BOXES = { sm: 4 / 5, md: 4 / 3, lg: 16 / 9 } as const;
/** Desktop: the text column covers up to 45% of the width and the scrim fades out by 72%, so the subject is aimed at 72% (or 28%). */
export const heroTarget = (a: Asset, bp: keyof typeof HERO_BOXES): Focal => (bp !== "lg" ? { x: 0.5, y: 0.45 } : { x: a.safe === "left" ? 0.72 : 0.28, y: 0.5 });
export const heroPositions = (a: Asset) => Object.fromEntries((Object.keys(HERO_BOXES) as (keyof typeof HERO_BOXES)[]).map((k) => [k, cropPosition(a, HERO_BOXES[k], heroTarget(a, k))])) as Record<keyof typeof HERO_BOXES, Focal>;

// ---- Rendering. Tokens (brand) live in the CSS; the page is the brief's copy in the template's sections.
/** The desktop hero text sits on this scrim (rgba) at full strength; QA checks its worst-case contrast over any image. */
export const HERO_SCRIM: [number, number, number, number] = [11, 33, 44, 0.9];
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (f: number) => `${(f * 100).toFixed(1)}%`;
const MARK = `<svg class="mark" viewBox="0 0 24 32" aria-hidden="true" focusable="false"><path d="M9 6h6l2 22H7z" fill="currentColor"/><path d="M8.3 13h7.4l.4 4H7.9zM7.6 21h8.8l.4 4H7.2z" fill="var(--signal)"/><path d="M10 2h4v4h-4z" fill="var(--brass)"/><path d="M14 3.5 23 0v8zM10 3.5 1 0v8z" fill="var(--brass)" opacity=".45"/><path d="M4 28h16v3H4z" fill="currentColor"/></svg>`;

function img(a: Asset, cls: string, eager = false, style = "") {
  return `<img class="${cls}" src="${esc(a.path)}" alt="${esc(a.alt)}" width="${a.width}" height="${a.height}"${eager ? ` fetchpriority="high"` : ` loading="lazy"`} decoding="async"${style ? ` style="${style}"` : ""}>`;
}
const paras = (b: string[]) => b.map((p) => `<p>${esc(p)}</p>`).join("");
const buttons = (c: Link[]) => (c.length ? `<p class="actions">${c.map((l, i) => `<a class="btn${i ? " btn-quiet" : ""}" href="${esc(l.href)}">${esc(l.label)}</a>`).join("")}</p>` : "");

export function section(x: Section, b: Brief): string {
  const a = x.image ? b.assets.find((y) => y.id === x.image) : undefined;
  const head = `<h2 id="${x.id}-title">${directionOf(b.style) ? accentHeading(esc(x.heading), true) : esc(x.heading).replace(/\*([^*]+)\*/, "$1")}</h2>`, attrs = `id="${x.id}" class="sec sec-${x.kind}" data-section="${x.id}" aria-labelledby="${x.id}-title"`;
  switch (x.kind) {
    case "hero": {
      const pos = a && heroPositions(a);
      const style = pos ? `--pos-sm:${pct(pos.sm.x)} ${pct(pos.sm.y)};--pos-md:${pct(pos.md.x)} ${pct(pos.md.y)};--pos-lg:${pct(pos.lg.x)} ${pct(pos.lg.y)}` : "";
      const dir = directionOf(b.style), d = dir && DIRECTIONS[dir], h1 = dir ? accentHeading(esc(x.heading)) : esc(x.heading);
      return `<section ${attrs.replace(`class="sec sec-hero"`, `class="hero${a ? ` safe-${a.safe}` : " no-image"}"`)}>${d && d.shader ? `<canvas class="aurora" aria-hidden="true" data-a="${d.shader[0]}" data-b="${d.shader[1]}" data-g="${d.shader[2]}"></canvas>` : ""}${a ? `<div class="hero-media">${img(a, "hero-img", true, style)}</div>` : ""}`
        + `<div class="hero-copy">${b.tagline ? `<p class="tagline">${esc(b.tagline)}</p>` : ""}<h1 id="${x.id}-title">${h1}</h1>${paras(x.body)}${buttons(x.cta)}</div></section>`;
    }
    case "features":
      return `<section ${attrs}><div class="wrap">${head}${paras(x.body)}<ol class="features">${x.items.map((it) => `<li>${it.label ? `<span class="stat">${esc(it.label)}</span>` : ""}<h3>${esc(it.title)}</h3><p>${esc(it.body)}</p></li>`).join("")}</ol></div></section>`;
    case "story":
      return `<section ${attrs}><div class="wrap split">${a ? `<figure class="story-media">${img(a, "story-img")}</figure>` : ""}<div class="story-copy">${head}${paras(x.body)}${buttons(x.cta)}</div></div></section>`;
    case "specs":
      return `<section ${attrs}><div class="wrap">${head}${paras(x.body)}<dl class="specs">${x.items.map((it) => `<div><dt>${esc(it.title)}</dt><dd>${esc(it.body)}</dd></div>`).join("")}</dl></div></section>`;
    case "sequence": return sequenceSection(x, attrs, esc);
    case "scene": return sceneSection(x, attrs, esc);
    case "faq":
      return `<section ${attrs}><div class="wrap narrow">${head}${paras(x.body)}${x.items.map((it) => `<details><summary>${esc(it.title)}</summary><p>${esc(it.body)}</p></details>`).join("")}</div></section>`;
    case "form":
      return `<section ${attrs}><div class="wrap split form-split"><div class="form-copy">${head}${paras(x.body)}</div>${leadForm(x, b.name)}</div></section>`;
  }
}

function leadForm(x: Section, name: string): string {
  const label = x.cta[0]?.label || "Send";
  const field = (id: string, lab: string, input: string, hint = "") => `<div class="field"><label for="${id}">${lab}</label>${hint ? `<p class="hint" id="${id}-hint">${hint}</p>` : ""}${input}<p class="err" id="${id}-err" hidden></p></div>`;
  return `<form class="lead" id="lead-form" novalidate data-endpoint="" aria-describedby="lead-status">`
    + `<div class="err-summary" id="lead-errors" role="alert" hidden></div>`
    + field("lead-name", "Your name", `<input id="lead-name" name="name" autocomplete="name" required maxlength="80" aria-describedby="lead-name-err">`)
    + field("lead-email", "Email", `<input id="lead-email" name="email" type="email" autocomplete="email" required aria-describedby="lead-email-hint lead-email-err">`, "We only write about this, and never share your address.")
    + (x.ask ? field("lead-use", `${esc(x.ask.label)} <span class="opt">(optional)</span>`, `<select id="lead-use" name="use"><option value="">Choose one</option>${x.ask.options.map((o) => `<option>${esc(o)}</option>`).join("")}</select>`) : "")
    + `<div class="field check"><input type="checkbox" id="lead-consent" name="consent" required aria-describedby="lead-consent-err"><label for="lead-consent">Email me about ${esc(name)}. Unsubscribe with one click.</label><p class="err" id="lead-consent-err" hidden></p></div>`
    + `<div class="trap" aria-hidden="true"><label for="lead-company">Company</label><input id="lead-company" name="company" tabindex="-1" autocomplete="off"></div>`
    + `<button type="submit" class="btn">${esc(label)}</button><p class="status" id="lead-status" role="status" aria-live="polite"></p></form>`;
}

/** The form's validator, shipped in js/form.js as is (tests run this exact text). Returns { field: message } for each problem. */
export const VALIDATE_JS = `function validateLead(v) {
  var e = {}, name = String(v.name || "").trim(), email = String(v.email || "").trim();
  if (!name) e.name = "Enter your name.";
  else if (name.length > 80) e.name = "Use 80 characters or fewer.";
  if (!email) e.email = "Enter your email address.";
  else if (!/^[^\\s@]+@[^\\s@.]+(?:\\.[^\\s@.]+)*\\.[a-z]{2,}$/i.test(email)) e.email = "Enter an email address like name@example.com.";
  if (!v.consent) e.consent = "Tick the box so we may email you.";
  return e;
}`;
/** Fake receiver unless data-endpoint is set: entries stay in this browser (window.__leads + localStorage). See EXPORT.md. */
export const FORM_JS = `${VALIDATE_JS}
(function () {
  var form = document.getElementById("lead-form");
  if (!form) return;
  var status = document.getElementById("lead-status"), summary = document.getElementById("lead-errors");
  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var d = new FormData(form);
    if (d.get("company")) return; // honeypot: a bot filled the hidden field
    var v = { name: d.get("name"), email: d.get("email"), use: d.get("use") || "", consent: d.get("consent") === "on" };
    var errs = validateLead(v), first = null;
    ["name", "email", "consent"].forEach(function (k) {
      var input = form.elements[k], box = document.getElementById("lead-" + k + "-err");
      if (errs[k]) { input.setAttribute("aria-invalid", "true"); box.textContent = errs[k]; box.hidden = false; first = first || input; }
      else { input.removeAttribute("aria-invalid"); box.textContent = ""; box.hidden = true; }
    });
    if (first) {
      var n = Object.keys(errs).length;
      summary.textContent = n === 1 ? "One thing to fix before we can save this." : n + " things to fix before we can save this.";
      summary.hidden = false; status.textContent = ""; first.focus(); return;
    }
    summary.hidden = true;
    var entry = { name: String(v.name).trim(), email: String(v.email).trim(), use: v.use, at: new Date().toISOString() };
    var done = function () { form.reset(); status.textContent = "Thanks, " + entry.name + ". You're on the list; we'll write to " + entry.email + "."; };
    var url = form.getAttribute("data-endpoint");
    if (!url) { // fake receiver (demo/export): nothing leaves this browser
      (window.__leads = window.__leads || []).push(entry);
      try { var k = "orbit-site-leads", all = JSON.parse(localStorage.getItem(k) || "[]"); all.push(entry); localStorage.setItem(k, JSON.stringify(all)); } catch (e) {}
      return done();
    }
    status.textContent = "Sending…";
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(entry) })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); done(); })
      .catch(function () { status.textContent = "That didn't go through. Check your connection and try again."; });
  });
})();
`;

const FAVICON = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32"><path d="M9 6h6l2 22H7z" fill="#0b212c"/><path d="M8.3 13h7.4l.4 4H7.9z" fill="#b3322a"/><path d="M10 2h4v4h-4z" fill="#d9a441"/></svg>`)}`;

export function renderHtml(b: Brief): string {
  const hero = b.sections.find((x) => x.kind === "hero")!, heroImg = hero.image ? b.assets.find((a) => a.id === hero.image) : undefined;
  const nav = b.sections.filter((x) => x.kind !== "hero" && x.kind !== "form").slice(0, 4);
  const form = b.sections.find((x) => x.kind === "form");
  return `<!doctype html>
<html lang="${b.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(b.name)}${b.tagline ? ` · ${esc(b.tagline)}` : ""}</title>
<meta name="description" content="${esc(b.description)}">
<meta name="generator" content="ORBIT site brief v${b.version}">
<meta property="og:title" content="${esc(b.name)}">
<meta property="og:description" content="${esc(b.description)}">
${ogImage(b, heroImg) ? `<meta property="og:image" content="${esc(ogImage(b, heroImg)!)}">\n` : ""}<meta name="theme-color" content="#0b212c">
<link rel="icon" href="${FAVICON}">
<link rel="stylesheet" href="css/style.css">
${directionOf(b.style) ? `<link rel="stylesheet" href="css/immersive.css">\n` : ""}</head>
<body data-version="${b.version}"${directionOf(b.style) ? ` class="immersive dir-${directionOf(b.style)}"` : ""}>
<a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="wrap bar"><a class="brand" href="#main">${MARK}<span>${esc(b.name)}</span></a>
<nav aria-label="Sections"><ul>${nav.map((x) => `<li><a href="#${x.id}">${esc(navLabel(x, b.sections))}</a></li>`).join("")}</ul>${form ? `<a class="btn btn-small" href="#${form.id}">${esc(form.cta[0]?.label || "Contact")}</a>` : ""}</nav></div></header>
<main id="main">
${b.sections.map((x) => section(x, b)).join("\n")}
</main>
<footer class="foot"><div class="wrap"><p class="brand">${MARK}<span>${esc(b.name)}</span></p><p>${esc(b.offer)}</p><p class="small">Version ${b.version}. <a href="#main">Back to top</a></p></div></footer>
<script src="js/form.js" defer></script>${directionOf(b.style) ? `\n<script src="js/immersive.js" defer></script>` : ""}
</body>
</html>
`;
}
/** Share image: the hero picture, else the middle frame of a sequence (the plan view of a fly-through). */
const ogImage = (b: Brief, hero?: Asset) => hero?.path ?? (() => { const q = b.sections.find((x) => x.seq)?.seq; if (q) return framePath(q.path, keyFrames(q.count)[1]); const sc = b.sections.find((x) => x.scene)?.scene; return sc ? sc.poster ?? sc.layers[0]?.path : undefined; })();
/** The cinematic standard's measurable part (site-guide.ts): no stand-in art in a finished site, and sequences smooth enough to feel
 *  like film. Asset origin "fixture", "stand-in" or "placeholder" marks art that still has to be replaced. */
export function artIssues(b: Brief): string[] {
  const out: string[] = [];
  for (const a of b.assets) if (/fixture|stand-?in|placeholder|grey-?box/i.test(a.origin)) out.push(`${a.id}: stand-in art (${a.origin}); replace it before calling the site finished`);
  for (const x of b.sections) if (x.seq) {
    if (x.seq.count < 120) out.push(`${x.id}: ${x.seq.count} frames feels steppy; use at least 120`);
    if (x.seq.width < 1600) out.push(`${x.id}: frames are ${x.seq.width}px wide; use at least 1600 so it stays sharp on a laptop`);
  }
  return out;
}
const NAV: Partial<Record<Kind, string>> = { features: "Features", story: "Story", specs: "Specs", faq: "FAQ", sequence: "Tour", scene: "Scene" };
/** Menu label: the kind's word, or the heading's first phrase when two sections share a kind (no "Story Story"). */
const navLabel = (x: Section, all: Section[] = []) => (all.filter((y) => y.kind === x.kind).length > 1 ? x.heading.replace(/\*/g, "").split(/[.,]/)[0].slice(0, 22) : NAV[x.kind] || x.heading);

/** Every file the brief renders (text only: the images are the owner's, already in the workspace, and are never written here). */
export function renderSite(b: Brief): Record<string, string> {
  return { "index.html": renderHtml(b), "css/style.css": SITE_CSS, "js/form.js": FORM_JS,
    ...(directionOf(b.style) ? { "css/immersive.css": IMMERSIVE_CSS + SEQUENCE_CSS + SCENE_CSS, "js/immersive.js": IMMERSIVE_JS + SEQUENCE_JS + SCENE_JS } : {}), "site.json": `${JSON.stringify(b, null, 2)}\n`, "EXPORT.md": exportMd(b) };
}

/** Image refs (src + alt) in rendered HTML, for the "copy edit doesn't touch assets" check. */
export const assetRefs = (html: string) => [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => `${/\ssrc="([^"]*)"/.exec(m[0])?.[1]}|${/\salt="([^"]*)"/.exec(m[0])?.[1]}|${/\sstyle="([^"]*)"/.exec(m[0])?.[1] ?? ""}`);

export function exportMd(b: Brief): string {
  return `# ${b.name}: site export (version ${b.version})

Open \`index.html\` in any browser. Everything it needs is in this folder (no web fonts, CDNs or tracking), so it works offline.

## What is where
- \`site.json\`: the brief. Copy, sections (stable IDs: ${b.sections.map((x) => `\`${x.id}\``).join(", ")}), image references and the version history. Edit copy here and rebuild in ORBIT, or edit \`index.html\` directly.
- \`index.html\`, \`css/style.css\`, \`js/form.js\`: the page. Brand colours and type are the custom properties at the top of the CSS.
- ${b.assets.map((a) => `\`${a.path}\` (${a.width}×${a.height}, ${a.origin})`).join("; ") || "no images"}.
- \`qa/\`: the QA report and screenshots at 360, 390, 768 and 1440 px.

## The form
The form validates in the browser and, until you connect a receiver, keeps entries only in the visitor's own browser (a fake receiver: nothing is sent anywhere). To collect real sign-ups:
1. Pick a receiver: a form service (Formspree, Basin, Netlify Forms) or your own endpoint that accepts a JSON POST.
2. Put its URL in \`data-endpoint=""\` on \`<form id="lead-form">\` in \`index.html\`. The page then POSTs \`{"name", "email", "use", "at"}\` as JSON and shows the thank-you only after a 2xx answer.
3. The endpoint must allow your site's origin (CORS) and should keep the consent record. Test once with your own address.
4. Add a privacy note link next to the checkbox if you collect emails in the EU.

## Publishing
Upload the whole folder to any static host (Netlify, Cloudflare Pages, GitHub Pages, your web host). Then set \`og:image\` to the full https:// address of \`${b.assets[0]?.path ?? "your image"}\` so link previews show the picture. ORBIT never publishes this for you.
`;
}

export const SITE_CSS = `/* Brand tokens: change these first. */
:root {
  --sea: #0b212c; --sea-2: #123446; --foam: #f3f6f7; --paper: #ffffff; --ink: #14232b; --muted: #4b5c65;
  --signal: #b3322a; --brass: #d9a441; --line: #cdd7dc; --hairline: rgba(255,255,255,.08); --mist: #b9c9d0;
  --display: "Bahnschrift", "DIN Alternate", "Barlow Semi Condensed", "Arial Narrow", "Liberation Sans Narrow", sans-serif;
  --body: "Segoe UI Variable Text", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "Cascadia Mono", "SF Mono", Consolas, "Liberation Mono", monospace;
  --s1: 4px; --s2: 8px; --s3: 16px; --s4: 24px; --s5: 32px; --s6: 48px; --s7: 64px; --s8: 96px;
  --gutter: clamp(16px, 4vw, 32px); --max: 1200px;
  /* Tones used by single rules (kept here so every colour is a token). */
  --tone-1: #dfe7ea; --tone-2: #fff; --tone-3: #e8b95a; --tone-4: rgba(243,246,247,.55); --tone-5: rgba(243,246,247,.1); --tone-6: #d6e0e4; --tone-7: rgba(11,33,44,.9); --tone-8: rgba(11,33,44,0); --tone-9: #c9d6db; --tone-10: rgba(243,246,247,.28); --tone-11: #8a9aa2; --tone-12: #fbeceb; --tone-13: #7d1f19; --tone-14: #1d5b3a;
}
*, *::before, *::after { box-sizing: border-box; }
html, body { overflow-x: clip; }
::selection { background: var(--brass); color: var(--sea); }
html { scroll-behavior: smooth; scroll-padding-top: 72px; -webkit-text-size-adjust: 100%; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body { margin: 0; background: var(--foam); color: var(--ink); font: 400 17px/1.6 var(--body); }
img { display: block; max-width: 100%; height: auto; }
h1, h2, h3 { font-family: var(--display); font-weight: 700; line-height: 1.08; letter-spacing: -0.01em; margin: 0 0 var(--s3); text-wrap: balance; }
h1 { font-size: clamp(40px, 7vw, 76px); letter-spacing: -0.02em; }
h2 { font-size: clamp(30px, 4.2vw, 46px); }
h3 { font-size: 21px; letter-spacing: 0; }
p { margin: 0 0 var(--s3); max-width: 62ch; }
a { color: inherit; text-underline-offset: 3px; }
:focus-visible { outline: 3px solid var(--brass); outline-offset: 3px; border-radius: 2px; }
.wrap { width: 100%; max-width: var(--max); margin: 0 auto; padding: 0 var(--gutter); }
.narrow { max-width: 820px; }
.skip { position: absolute; left: var(--s3); top: -60px; z-index: 10; background: var(--paper); color: var(--ink); padding: var(--s2) var(--s3); }
.skip:focus { top: var(--s2); }

/* Header */
.top { position: sticky; top: 0; z-index: 5; background: var(--sea); color: var(--foam); border-bottom: 1px solid var(--hairline); }
.bar { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); min-height: 60px; }
.brand { display: inline-flex; align-items: center; gap: 10px; font: 700 19px/1 var(--display); text-decoration: none; margin: 0; }
.mark { width: 18px; height: 24px; flex: none; }
nav { display: flex; align-items: center; gap: var(--s4); }
nav ul { display: none; list-style: none; margin: 0; padding: 0; gap: var(--s4); }
nav ul a { text-decoration: none; font-size: 15px; padding: 10px 0; color: var(--tone-1); }
nav ul a:hover { color: var(--tone-2); text-decoration: underline; }
@media (min-width: 760px) { nav ul { display: flex; } }

/* Buttons: 44px+ tap targets */
.btn { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 0 var(--s4); border: 2px solid var(--brass); background: var(--brass); color: var(--sea);
  font: 700 16px/1 var(--body); text-decoration: none; border-radius: 2px; cursor: pointer; transition: background .15s, color .15s; }
.btn:hover { background: var(--tone-3); border-color: var(--tone-3); }
.btn-quiet { background: transparent; color: var(--foam); border-color: var(--tone-4); }
.btn-quiet:hover { background: var(--tone-5); border-color: var(--foam); }
.btn-small { min-height: 44px; padding: 0 var(--s3); font-size: 15px; white-space: nowrap; }
.brand span { white-space: nowrap; }
@media (max-width: 400px) { .btn-small { padding: 0 12px; font-size: 14px; } .top .brand { font-size: 17px; gap: 8px; } }
.actions { display: flex; flex-wrap: wrap; gap: var(--s3); margin-top: var(--s5); }

/* Hero: phone/tablet = cropped image, then the text on solid sea; desktop = full-bleed image, text on the scrim over the safe side. */
.hero { position: relative; background: var(--sea); color: var(--foam); overflow: hidden; }
.hero-media { aspect-ratio: 4 / 5; max-height: 78vh; overflow: hidden; }
.hero-img { width: 100%; height: 100%; object-fit: cover; object-position: var(--pos-sm, 50% 50%); }
.hero-copy { padding: var(--s5) var(--gutter) var(--s7); max-width: 40rem; }
.hero-copy p { font-size: 19px; color: var(--tone-6); }
.hero-copy .tagline { font: 600 17px/1.3 var(--body); color: var(--brass); margin-bottom: var(--s3); }
@media (min-width: 600px) { .hero-media { aspect-ratio: 4 / 3; } .hero-img { object-position: var(--pos-md, 50% 50%); } .hero-copy { padding-top: var(--s6); } }
@media (min-width: 900px) {
  .hero { min-height: min(88vh, 860px); display: flex; align-items: center; }
  .hero-media { position: absolute; inset: 0; aspect-ratio: auto; max-height: none; }
  .hero-img { object-position: var(--pos-lg, 50% 50%); }
  .hero::before { content: ""; position: absolute; inset: 0; z-index: 1;
    background: linear-gradient(90deg, var(--tone-7) 0, var(--tone-7) 45%, var(--tone-8) 72%); }
  .safe-right::before { background: linear-gradient(270deg, var(--tone-7) 0, var(--tone-7) 45%, var(--tone-8) 72%); }
  .hero-copy { position: relative; z-index: 2; width: calc(45vw - var(--s5)); max-width: 34rem; padding: var(--s8) 0;
    margin-left: max(var(--gutter), calc((100vw - var(--max)) / 2 + var(--gutter))); }
  .safe-right .hero-copy { margin-left: auto; margin-right: max(var(--gutter), calc((100vw - var(--max)) / 2 + var(--gutter))); }
}

/* Sections */
.sec { padding: var(--s7) 0; }
@media (min-width: 900px) { .sec { padding: var(--s8) 0; } }
.sec > .wrap > p, .story-copy p, .form-copy p { color: var(--muted); }
.sec-features { background: var(--paper); }
.features { list-style: none; margin: var(--s6) 0 0; padding: 0; display: grid; gap: var(--s5); }
@media (min-width: 760px) { .features { grid-template-columns: repeat(3, 1fr); gap: var(--s6); } }
.features li { border-top: 3px solid var(--ink); padding-top: var(--s4); }
.features p { color: var(--muted); margin: 0; }
.stat { display: block; font: 700 clamp(38px, 5vw, 52px)/1 var(--display); color: var(--signal); margin-bottom: var(--s3); letter-spacing: -0.02em; }

.split { display: grid; gap: var(--s5); align-items: center; }
@media (min-width: 900px) { .split { grid-template-columns: 5fr 6fr; gap: var(--s7); } }
.story-media { margin: 0; }
.story-img { width: 100%; aspect-ratio: 4 / 5; object-fit: cover; }

/* Specs: set like a light list entry */
.sec-specs { background: var(--sea); color: var(--foam); }
.sec-specs .wrap > p { color: var(--tone-9); }
.specs { margin: var(--s5) 0 0; font-family: var(--mono); font-size: 15px; display: grid; }
@media (min-width: 760px) { .specs { grid-template-columns: 1fr 1fr; column-gap: var(--s7); } }
.specs div { display: flex; gap: var(--s3); justify-content: space-between; align-items: baseline; padding: 14px 0; border-bottom: 1px dashed var(--tone-10); }
.specs dt { color: var(--mist); font-size: 14px; }
.specs dd { margin: 0; text-align: right; color: var(--tone-2); }

/* FAQ */
.sec-faq { background: var(--paper); }
details { border-bottom: 1px solid var(--line); }
details:first-of-type { border-top: 1px solid var(--line); margin-top: var(--s5); }
summary { cursor: pointer; list-style: none; padding: 20px 40px 20px 0; position: relative; font: 600 19px/1.35 var(--body); }
summary::-webkit-details-marker { display: none; }
summary::after { content: "+"; position: absolute; right: 4px; top: 16px; font: 400 28px/1 var(--display); color: var(--signal); }
details[open] summary::after { content: "\\2212"; }
details p { color: var(--muted); padding-bottom: var(--s3); }

/* Form */
.form-split { align-items: start; }
.lead { background: var(--paper); border: 1px solid var(--line); padding: var(--s5) var(--s4); display: grid; gap: var(--s4); }
@media (min-width: 600px) { .lead { padding: var(--s6) var(--s5); } }
.field { display: grid; gap: 6px; }
.field label { font-weight: 600; font-size: 16px; }
.opt, .hint { color: var(--muted); font-weight: 400; font-size: 15px; margin: 0; }
input, select { font: inherit; color: var(--ink); background: var(--tone-2); border: 1.5px solid var(--tone-11); border-radius: 2px; min-height: 48px; padding: 0 12px; width: 100%; }
input:focus-visible, select:focus-visible { outline-offset: 1px; }
input[aria-invalid="true"] { border-color: var(--signal); border-width: 2px; }
.check { grid-template-columns: 24px 1fr; align-items: start; column-gap: 12px; }
.check input { width: 24px; min-height: 24px; height: 24px; margin: 2px 0 0; accent-color: var(--sea); }
.check label { font-weight: 400; }
.check .err { grid-column: 2; }
.err { color: var(--signal); font-size: 15px; font-weight: 600; margin: 0; }
.err-summary { background: var(--tone-12); color: var(--tone-13); border-left: 4px solid var(--signal); padding: 12px var(--s3); font-weight: 600; }
.status { margin: 0; font-weight: 600; color: var(--tone-14); }
.status:empty { display: none; }
.trap { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
.lead .btn { justify-self: start; }

/* Footer */
.foot { background: var(--sea); color: var(--tone-9); padding: var(--s6) 0; font-size: 15px; }
.foot .brand { color: var(--foam); margin-bottom: var(--s3); }
.foot .small { font-size: 14px; margin: 0; }
`;
