// VAULT: pure helpers (no node/next imports) shared by the server, the API route, the panel and the tests.

export const MAX_FILE = 40 * 1024 * 1024;
export const MAX_TOTAL = 5 * 1024 * 1024 * 1024;
export const MAX_FILES = 2000;
export const MAX_NAME = 120;
export const INDEX_FILE = ".index.json";
export const PREVIEW_BYTES = 20 * 1024;
export const INDEX_TEXT_MAX = 200 * 1024;
export const MEMORY_MAX = 4 * 1024 * 1024; // /api/memories/upload limit

export type Kind = "image" | "video" | "audio" | "pdf" | "text" | "doc" | "other";
export type VaultFile = { name: string; size: number; mtime: number; type: Kind };

const RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;
// Control chars, Windows-forbidden chars, and bidi/zero-width marks that can disguise an extension ("txt.exe" shown as "exe.txt").
const BAD = /[\u0000-\u001f\u007f-\u009f<>:"|?*\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** Split "a.tar.gz" → ["a.tar", ".gz"]; no extension → [name, ""]. Leading-dot names have no extension. */
export function splitExt(name: string): [string, string] {
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? [name.slice(0, i), name.slice(i)] : [name, ""];
}

/** Turn any user/browser-supplied name into one safe flat file name inside the vault. Never empty, never a path.
 *  "~digit" becomes "-digit": NTFS 8.3 short names (REPORT~1.PDF, INDEX~1.JSO) alias other files. */
export function sanitizeName(raw: unknown): string {
  let s = String(raw ?? "").normalize("NFC");
  s = s.split(/[\\/]/).pop() ?? "";
  s = s.replace(BAD, "").replace(/~(?=\d)/g, "-").replace(/\s+/g, " ").replace(/^[\s.]+/, "").replace(/[\s.]+$/, "");
  if (s.length > MAX_NAME) {
    const [base, ext] = splitExt(s);
    s = ext.length <= 16 ? base.slice(0, MAX_NAME - ext.length).replace(/[\s.]+$/, "") + ext : s.slice(0, MAX_NAME);
    s = s.replace(/[\s.]+$/, "");
  }
  // Windows reserves CON, NUL, COM1… also with any extension ("nul.txt", "con .txt").
  if (RESERVED.test(s.split(".")[0].trim())) s = `_${s}`.slice(0, MAX_NAME);
  if (!s || s.toLowerCase() === INDEX_FILE || s.toLowerCase() === INDEX_FILE.slice(1)) s = s ? `_${s}` : "file";
  return s;
}

/** "a.txt", 2 → "a (2).txt", kept within MAX_NAME. */
export function withSuffix(name: string, n: number): string {
  const [base, ext] = splitExt(name);
  const tag = ` (${n})`;
  return base.slice(0, MAX_NAME - tag.length - ext.length) + tag + ext;
}

/** First free variant of name; comparison is case-insensitive because Windows file names are. */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const set = new Set([...taken].map((t) => t.toLowerCase()));
  if (!set.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) { const c = withSuffix(name, n); if (!set.has(c.toLowerCase())) return c; }
}

/** Rename input: keep the old extension unless the user typed one. */
export function renameTarget(oldName: string, input: unknown): string {
  const typed = sanitizeName(input);
  const [, oldExt] = splitExt(oldName);
  return splitExt(typed)[1] || !oldExt ? typed : sanitizeName(typed + oldExt);
}

const ext = (name: string) => splitExt(name)[1].slice(1).toLowerCase();

// Only these are ever served with their real type. Everything else is application/octet-stream + attachment,
// so html/svg/xml/js can never run in ORBIT's origin.
const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", pdf: "application/pdf",
  txt: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8", csv: "text/plain; charset=utf-8", json: "text/plain; charset=utf-8", log: "text/plain; charset=utf-8",
};
const TEXTISH = new Set(["txt", "md", "markdown", "csv", "json", "log", "ts", "tsx", "js", "jsx", "mjs", "py", "lua", "luau", "css", "html", "htm", "xml", "svg",
  "yml", "yaml", "ini", "toml", "sh", "ps1", "bat", "c", "cpp", "h", "hpp", "cs", "java", "go", "rs", "sql", "env", "cfg"]);

export function kindOf(name: string): Kind {
  const e = ext(name);
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(e)) return "image";
  if (["mp4", "webm"].includes(e)) return "video";
  if (["mp3", "wav"].includes(e)) return "audio";
  if (e === "pdf") return "pdf";
  if (TEXTISH.has(e)) return "text";
  if (e === "docx") return "doc";
  return "other";
}

/** Headers for serving a vault file. Inline only for the allowlist above; never html/svg/xml/js. */
export function serveHeaders(name: string): Record<string, string> {
  const type = MIME[ext(name)];
  const inline = !!type;
  const k = kindOf(name);
  // Chrome refuses to render PDFs in a sandboxed document, so PDFs get a locked-down CSP without "sandbox".
  const csp = k === "pdf" ? "default-src 'none'; object-src 'self'; frame-ancestors 'none'"
    : `sandbox; default-src 'none'${k === "image" ? "; img-src 'self'" : k === "video" || k === "audio" ? "; media-src 'self'" : ""}`;
  return {
    "Content-Type": type ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": csp,
    "Content-Disposition": contentDisposition(name, inline),
    "Cache-Control": "private, no-store",
  };
}

/** RFC 6266 / 5987: ASCII fallback plus UTF-8 filename*. */
export function contentDisposition(name: string, inline: boolean): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\%;]/g, "_");
  const star = encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${star}`;
}

/** Single "bytes=a-b" range → [start, end] inclusive; null = serve whole file; "bad" = 416. */
export function parseRange(header: string | null, size: number): [number, number] | null | "bad" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number, end: number;
  if (!m[1]) { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  return start > end || start >= size ? "bad" : [start, end];
}

/** Content type for extractText; null = not content-searchable. */
export function extractType(name: string, docx: string): string | null {
  const e = ext(name);
  if (["txt", "json", "log"].includes(e)) return "text/plain";
  if (["md", "markdown"].includes(e)) return "text/markdown";
  if (e === "csv") return "text/csv";
  if (e === "pdf") return "application/pdf";
  if (e === "docx") return docx;
  return null;
}

/** MIME type to send to /api/memories/upload (which checks it), or null when MEMORY doesn't accept the file. */
export function memoryType(name: string): string | null {
  return ({ pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain", md: "text/markdown", csv: "text/csv",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" } as Record<string, string>)[ext(name)] ?? null;
}

/** ~160 chars around the first case-insensitive hit, or null. */
export function snippet(text: string, q: string): string | null {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return null;
  const s = Math.max(0, i - 60);
  return (s > 0 ? "…" : "") + text.slice(s, i + q.length + 100).replace(/\s+/g, " ").trim() + (i + q.length + 100 < text.length ? "…" : "");
}

export function fmtSize(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Upload checks against current usage; returns an error message or null. */
export function uploadError(size: number, used: { bytes: number; count: number }): string | null {
  if (size > MAX_FILE) return `Files can be at most 40 MB (this one is ${fmtSize(size)})`;
  if (used.count >= MAX_FILES) return `The vault is full (${MAX_FILES} files). Delete something first.`;
  if (used.bytes + size > MAX_TOTAL) return `Not enough vault space: ${fmtSize(MAX_TOTAL - used.bytes)} left of 5 GB`;
  return null;
}
