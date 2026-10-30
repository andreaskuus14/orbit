import { createHmac, timingSafeEqual } from "node:crypto";

// Workspaces: folders of real files CORE builds (a website, a script) under <ORBIT data dir>/workspaces/<user id>/<slug>.
// Pure rules (paths, caps, content types, preview links), tested in tests/workspace.test.ts; the disk side is workspace.ts.

export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_FILES = 200;
export const MAX_WS_BYTES = 20 * 1024 * 1024;
export const MAX_WORKSPACES = 50;
const MAX_PATH = 200, MAX_DEPTH = 8;

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8", svg: "image/svg+xml", md: "text/plain; charset=utf-8", txt: "text/plain; charset=utf-8",
  lua: "text/plain; charset=utf-8", luau: "text/plain; charset=utf-8", py: "text/plain; charset=utf-8", csv: "text/plain; charset=utf-8",
  sql: "text/plain; charset=utf-8",
};
export const WS_EXTS = Object.keys(TYPES);
const ext = (p: string) => (/\.([a-z0-9]+)$/i.exec(p)?.[1] ?? "").toLowerCase();
/** Served type; md/lua/py etc. as plain text so they're shown, never rendered or run. */
export const contentType = (p: string) => TYPES[ext(p)] ?? "application/octet-stream";

// Windows device names can't be files there (ORBIT's data dir is %LOCALAPPDATA%\orbit).
const RESERVED = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9]) *(?:\.|$)/i; // Windows ignores spaces before the dot: "con .txt"

/** A safe workspace-relative path ("site/index.html") or { error }. Relative only: no "..", "/x", "C:", "\", NUL, dotfiles (keeps
 *  .trash out of reach), ":" (Windows streams) or names Windows can't store. */
export function checkPath(p: unknown): { path: string } | { error: string } {
  if (typeof p !== "string" || !p) return { error: "path is required" };
  if (p.length > MAX_PATH) return { error: `path is longer than ${MAX_PATH} characters` };
  if (p.includes("\\")) return { error: "use / in paths, not \\" };
  if (p.startsWith("/") || /^[a-z]:/i.test(p)) return { error: "path must be relative to the workspace" };
  const segs = p.split("/");
  if (segs.length > MAX_DEPTH) return { error: `at most ${MAX_DEPTH} folders deep` };
  if (segs.at(-1) === ".env.example") return { path: p }; // full-stack template: variable names only (ws-server-pure envExampleError)
  for (const s of segs) {
    if (s === "." || s === "..") return { error: "path can't contain . or .." };
    if (!/^[A-Za-z0-9_][A-Za-z0-9._ -]*$/.test(s)) return { error: `invalid name "${s.slice(0, 40)}" (letters, digits, . _ - and spaces; not starting with . or -)` };
    if (/[. ]$/.test(s) || RESERVED.test(s)) return { error: `invalid name "${s}"` };
  }
  if (!WS_EXTS.includes(ext(p))) return { error: `file type not allowed (use ${WS_EXTS.join(", ")})` };
  return { path: p };
}

/** "My Cool Site!" → "my-cool-site"; null when nothing usable is left. */
export function slugify(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const s = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return s && !RESERVED.test(s) ? s : null;
}
export const isSlug = (s: unknown): s is string => typeof s === "string" && slugify(s) === s;
export const isUserId = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9-]{1,64}$/.test(s);

/** Size caps for one write: content bytes, the file it replaces (0 = new), files already there and the workspace total. */
export function capError(bytes: number, oldBytes: number | null, fileCount: number, totalBytes: number): string | null {
  if (bytes > MAX_FILE_BYTES) return `file is over ${MAX_FILE_BYTES / 1024} KB`;
  if (oldBytes === null && fileCount >= MAX_FILES) return `workspace already has ${MAX_FILES} files`;
  if (totalBytes - (oldBytes ?? 0) + bytes > MAX_WS_BYTES) return `workspace would be over ${MAX_WS_BYTES / 1024 / 1024} MB`;
  return null;
}

// Preview links: /w/<user id>.<slug>.<exp>.<sig>/<path>. The sig (HMAC with this PC's secret key over uid, slug, expiry and the
// workspace's random nonce) is what lets the sandboxed page load its own CSS/JS: a sandboxed page has an opaque origin, so its
// subresource requests carry no SameSite cookies. The nonce is new each time a workspace is created, so a recreated slug gets a new link.
export const PREVIEW_TTL_S = 7 * 24 * 3600;
const sign = (key: Buffer, nonce: string, uid: string, slug: string, exp: string) =>
  createHmac("sha256", key).update(`${uid}/${slug}/${exp}/${nonce}`).digest("base64url").slice(0, 22);
export const previewSeg = (key: Buffer, nonce: string, uid: string, slug: string, nowS: number) => {
  const exp = String(Math.floor(nowS) + PREVIEW_TTL_S);
  return `${uid}.${slug}.${exp}.${sign(key, nonce, uid, slug, exp)}`;
};

/** The parts of a link segment (not yet verified: the nonce lives on disk). */
export function parsePreviewSeg(seg: string): { uid: string; slug: string; exp: string; sig: string } | null {
  const [uid, slug, exp, sig, extra] = seg.split(".");
  return extra === undefined && isUserId(uid) && isSlug(slug) && /^\d{1,12}$/.test(exp ?? "") && /^[A-Za-z0-9_-]{22}$/.test(sig ?? "") ? { uid, slug, exp, sig } : null;
}

export function previewValid(key: Buffer, nonce: string, p: { uid: string; slug: string; exp: string; sig: string }, nowS: number): boolean {
  if (Number(p.exp) < nowS) return false;
  const want = Buffer.from(sign(key, nonce, p.uid, p.slug, p.exp)), got = Buffer.from(p.sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

// Requests that show the page itself (or embed it) need the signed-in session too; only the page's own subresources ride on the link.
const PAGE_DESTS = new Set(["document", "iframe", "frame", "embed", "object", "fencedframe"]);
export const previewNeedsSession = (secFetchDest: string | null | undefined) => !secFetchDest || PAGE_DESTS.has(secFetchDest.toLowerCase());

/** Same file on disk? Windows and macOS file systems ignore case; Linux doesn't. */
export const sameFile = (a: string, b: string, foldCase: boolean) => (foldCase ? a.toLowerCase() === b.toLowerCase() : a === b);

/** URL path parts after the workspace segment → a file path; "" or a trailing "/" means that folder's index.html. */
export function previewPath(parts: string[]): string {
  const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } }; // checkPath vets the result either way
  const p = parts.map(dec).join("/");
  return !p || p.endsWith("/") ? `${p}index.html` : p;
}

// Served on every preview response. sandbox without allow-same-origin = opaque origin: the page's scripts can't read ORBIT's
// cookies or call /api as the user (POSTs arrive with Origin: null and csrf.ts refuses them).
export const PREVIEW_HEADERS = {
  // No https: — the page can't load from or send to other sites (no exfiltration); external CDNs don't work in preview.
  "Content-Security-Policy": "sandbox allow-scripts; default-src 'self' 'unsafe-inline' data: blob:; form-action 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer", // the link's sig must never leave in a Referer
  "Cache-Control": "no-store",
};
