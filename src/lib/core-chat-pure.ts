// CORE chat polish, pure parts (browser + node tests in tests/core-chat.test.ts): answer blocks for the rich view (code, tables,
// media), when a long answer folds, the composer keys, the "Working on it" card for a long turn, and the chat search helpers.
// Keep this file free of non-erasable TS syntax (it runs under node --experimental-strip-types).
import { plainStep, stepsFrom, type Progress } from "./progress-pure.ts";
import type { Lang } from "./i18n-pure.ts";

export type MediaKind = "image" | "video" | "audio" | "pdf" | "model" | "file";
export type Block =
  | { kind: "text"; text: string }
  | { kind: "code"; lang: string; code: string; open: boolean } // open: the closing fence hasn't streamed in yet
  | { kind: "table"; head: string[]; rows: string[][]; align: ("left" | "right" | "center")[] }
  | { kind: "media"; media: MediaKind; url: string; label: string; inline: boolean };

const EXT: [RegExp, MediaKind][] = [
  [/\.(png|jpe?g|webp|gif|avif|svg)$/i, "image"], [/\.(mp4|webm|mov|m4v)$/i, "video"], [/\.(mp3|wav|ogg|m4a|flac|aac)$/i, "audio"],
  [/\.pdf$/i, "pdf"], [/\.(glb|gltf|fbx|obj|stl|usdz|ply|splat)$/i, "model"],
];
/** What a link points at, by the file name in its path (or its file= query, as /api/workspace links carry it). */
export function mediaKind(url: string): MediaKind | null {
  let path = url;
  try { const u = new URL(url, "http://x"); path = u.searchParams.get("file") || u.searchParams.get("name") || u.pathname; } catch { return null; }
  for (const [re, k] of EXT) if (re.test(path)) return k;
  return null;
}
/** Only ORBIT's own files load inline (an outside picture would tell that site the chat was opened); outside https links stay links. */
export function ownUrl(url: string): boolean {
  if (!url.startsWith("/") || url.startsWith("//") || url.includes("\\")) return false;
  return /^\/(api|w)\//.test(url) && !/\.\.|%2e%2e/i.test(url);
}
const okUrl = (u: string) => ownUrl(u) || /^https:\/\/[^\s]+$/i.test(u);

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isRule = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const isRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
// A line that is only a media link: ![alt](url), [label](url) or a bare url.
const MEDIA_LINE = /^\s*(?:!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|(\/(?:api|w)\/\S+|https:\/\/\S+))\s*$/;

/** Split an answer (finished or still streaming) into blocks. Text between blocks stays Markdown for the plain renderer. */
export function chatBlocks(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.split("\n");
  let buf: string[] = [];
  const flush = () => { const t = buf.join("\n"); if (t.trim()) out.push({ kind: "text", text: t }); buf = []; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*(```+|~~~+)\s*([\w+#.-]*)/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      let j = i + 1;
      for (; j < lines.length && !lines[j].trim().startsWith(fence[1]); j++) code.push(lines[j]);
      out.push({ kind: "code", lang: fence[2].toLowerCase(), code: code.join("\n"), open: j >= lines.length });
      i = j;
      continue;
    }
    if (isRow(line) && i + 1 < lines.length && isRule(lines[i + 1])) {
      flush();
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left") as "left" | "right" | "center");
      const rows: string[][] = [];
      let j = i + 2;
      for (; j < lines.length && isRow(lines[j]); j++) { const r = cells(lines[j]); rows.push(head.map((_, k) => r[k] ?? "")); }
      out.push({ kind: "table", head, rows, align: head.map((_, k) => align[k] ?? "left") });
      i = j - 1;
      continue;
    }
    const m = MEDIA_LINE.exec(line);
    const url = m ? m[2] ?? m[4] ?? m[5] : "";
    const kind = url ? mediaKind(url) : null;
    if (m && kind && okUrl(url)) {
      flush();
      const label = (m[1] ?? m[3] ?? "").trim() || decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() || url);
      out.push({ kind: "media", media: kind, url, label, inline: ownUrl(url) && kind !== "model" && kind !== "file" });
      continue;
    }
    buf.push(line);
  }
  flush();
  return out;
}

/** Long answers fold to a preview with "Show all" (Claude-style); code folds on its own past CODE_FOLD lines. */
export const LONG_CHARS = 3500, LONG_LINES = 60, CODE_FOLD = 24;
export const isLong = (text: string) => text.length > LONG_CHARS || text.split("\n").length > LONG_LINES;

/** Composer keys: Enter sends, Shift+Enter is a new line, nothing while an IME is composing (Estonian dead keys, emoji pickers). */
export function composerKey(e: { key: string; shiftKey: boolean; isComposing?: boolean; keyCode?: number }): "send" | null {
  if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return null;
  return "send";
}

/** The chat list follows new text only while the reader is near the bottom. */
export const nearBottom = (scrollHeight: number, scrollTop: number, clientHeight: number, slack = 80) => scrollHeight - scrollTop - clientHeight < slack;

/** A turn counts as long work (shown as the shared "Working on it" card) once it handed off to the background or ran this long. */
export const LONG_TURN_MS = 20_000;
type Row = { label: string; key?: string; ok?: boolean; tool?: string };
/** A running CORE turn → the shared Progress card: its live steps in plain words, then "Writing the answer". */
export function turnProgress(o: { id: string; title: string; rows: Row[]; streaming: boolean; taskId: string | null; startedAt: number; lang: Lang; label?: (r: Row) => string }): Progress {
  const write = o.lang === "et" ? "Kirjutan vastust" : "Writing the answer";
  const labels: string[] = [];
  for (const r of o.rows) { const l = o.label ? o.label(r) : plainStep(r.tool ?? r.label, o.lang); if (l && labels.at(-1) !== l) labels.push(l); }
  const all = [...labels, write];
  // The current step: the writing step once text streams, else the newest still-open step (or the next one after a finished step).
  const current = o.streaming ? all.length - 1 : Math.max(0, labels.length - (o.rows.at(-1)?.ok === undefined ? 1 : 0));
  const steps = stepsFrom(all, Math.min(current, all.length - 1));
  return {
    id: o.id, title: o.title, phase: "working", steps, now: steps.find((s) => s.state === "now")?.label ?? write, leftMin: null,
    result: null, action: o.taskId ? { kind: "open", label: o.lang === "et" ? "Ava" : "Open", open: `#o=operations&k=task&id=${encodeURIComponent(o.taskId)}` } : null,
    at: new Date(o.startedAt).toISOString(),
  };
}

/** Chat search: the typed words, trimmed, max 80 chars; null when too short to search. */
export function searchQuery(q: unknown): string | null {
  if (typeof q !== "string") return null;
  const t = q.replace(/\s+/g, " ").trim().slice(0, 80);
  return t.length >= 2 ? t : null;
}
/** PostgREST ilike pattern: % and _ in his words match literally; commas/parens would break an or() filter, so they become spaces. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[,()]/g, " ")}%`;
/** A short piece of the message around the first match, for the result line. */
export function snippet(content: string, q: string, width = 90): string {
  const flat = content.replace(/\s*\[[ma]:[^\]]+\]/g, "").replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return flat.slice(0, width) + (flat.length > width ? "…" : "");
  const start = Math.max(0, at - Math.floor((width - q.length) / 2));
  const piece = flat.slice(start, start + width);
  return (start > 0 ? "…" : "") + piece + (start + width < flat.length ? "…" : "");
}
/** Filter chat titles right away while the server search over messages is on its way. */
export function titleHits<T extends { title: string }>(chats: T[], q: string): T[] {
  const words = q.toLowerCase().split(" ").filter(Boolean);
  return chats.filter((c) => { const t = c.title.toLowerCase(); return words.every((w) => t.includes(w)); });
}

/** He asks for the words in a photo ("read this receipt", "loe see tekst"): the picture is also OCR'd on this PC, not only looked at. */
export const wantsPhotoText = (message: string) =>
  /\b(read|transcribe|ocr|text|words|receipt|invoice|scan(ned)?|document|copy out|type out|loe|tekst|teksti|kviitung|arve|dokument|skann)\b/i.test(message);

/** The phone chat's service worker: what it may answer from its cache. "static" = Next's hashed build files (cache first),
 *  "shell" = the /chat page (network first, cached copy when the PC can't be reached), null = always live, never cached (all /api). */
export function chatSwRoute(method: string, path: string): "static" | "shell" | null {
  if (method !== "GET") return null;
  if (path.startsWith("/_next/static/")) return "static";
  if (path === "/chat" || path === "/chat/") return "shell";
  return null;
}
