// Sandboxed Generative UI ("Living Canvas") — pure parsing, security validation, CSP srcDoc builder, and postMessage protocol.
// Tested in tests/gen-ui.test.ts. Zero network egress, zero parent-frame escape, zero private data leakage (AGENTS.md rule 6).

export type GenUiKind = "chart" | "simulator" | "table" | "diagram" | "custom";

export type GenUiBlock = {
  id: string;
  title: string;
  kind: GenUiKind;
  html: string;
  height?: number;
  streaming: boolean;
};

export type MarkdownSegment =
  | { type: "markdown"; text: string }
  | { type: "gen-ui"; block: GenUiBlock };

export type GenUiValidation =
  | { ok: true }
  | { ok: false; reason: string; code: "empty" | "too-large" | "egress" | "escape" };

export type GenUiAction =
  | { type: "resize"; height: number }
  | { type: "copy"; text: string }
  | { type: "ask"; prompt: string }
  | { type: "navigate"; target: string };

export const MAX_GEN_UI_BYTES = 120_000;
export const MIN_GEN_UI_HEIGHT = 120;
export const MAX_GEN_UI_HEIGHT = 1200;
export const DEFAULT_GEN_UI_HEIGHT = 340;

const VALID_KINDS = new Set<GenUiKind>(["chart", "simulator", "table", "diagram", "custom"]);

/** Strict offline CSP: no external scripts, styles, fonts, images, XHR/fetch/WS, or form submissions. */
export const GEN_UI_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";

const OPEN_RE = /^```(?:orbit-ui|gen-ui)(?:[ \t]+([^\r\n]*))?\r?$/;
const CLOSE_RE = /^```[ \t]*\r?$/;

function parseMeta(raw: string | undefined, idx: number): { title: string; kind: GenUiKind; height?: number } {
  const fallback = { title: `Interactive View ${idx + 1}`, kind: "custom" as GenUiKind };
  if (!raw || !raw.trim()) return fallback;
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const title = typeof obj.title === "string" && obj.title.trim() ? obj.title.trim().slice(0, 80) : fallback.title;
      const kind = typeof obj.kind === "string" && VALID_KINDS.has(obj.kind as GenUiKind) ? (obj.kind as GenUiKind) : "custom";
      const height = typeof obj.height === "number" && Number.isFinite(obj.height) ? clampHeight(obj.height) : undefined;
      return { title, kind, height };
    } catch {
      return fallback;
    }
  }
  // Support compact `kind=simulator title="Pricing Lab"` or plain title after the fence
  const titleMatch = /title="([^"]{1,80})"/.exec(trimmed);
  const kindMatch = /kind=([a-z]+)/.exec(trimmed);
  const heightMatch = /height=(\d{2,4})/.exec(trimmed);
  const kind = kindMatch && VALID_KINDS.has(kindMatch[1] as GenUiKind) ? (kindMatch[1] as GenUiKind) : "custom";
  const height = heightMatch ? clampHeight(Number(heightMatch[1])) : undefined;
  const title = titleMatch?.[1]?.trim() || (!kindMatch && !heightMatch ? trimmed.slice(0, 80) : fallback.title);
  return { title, kind, height };
}

/** Split a CORE/agent markdown reply into prose segments and `orbit-ui` / `gen-ui` interactive widget blocks.
 *  Unclosed fences at the end of a streaming reply are returned with `streaming: true`. */
export function extractGenUiBlocks(markdown: string): MarkdownSegment[] {
  const lines = markdown.split("\n");
  const segments: MarkdownSegment[] = [];
  let mdBuf: string[] = [];
  let inOtherFence = false;
  let active: { metaRaw: string | undefined; lines: string[]; index: number } | null = null;
  let widgetCount = 0;

  const flushMd = () => {
    const text = mdBuf.join("\n");
    if (text.trim()) segments.push({ type: "markdown", text });
    mdBuf = [];
  };

  for (const line of lines) {
    if (active) {
      if (CLOSE_RE.test(line)) {
        const meta = parseMeta(active.metaRaw, active.index);
        segments.push({
          type: "gen-ui",
          block: {
            id: `gen-ui-${active.index}`,
            title: meta.title,
            kind: meta.kind,
            height: meta.height,
            html: active.lines.join("\n").trim(),
            streaming: false,
          },
        });
        active = null;
      } else {
        active.lines.push(line);
      }
      continue;
    }

    const openMatch = !inOtherFence ? OPEN_RE.exec(line) : null;
    if (openMatch) {
      flushMd();
      active = { metaRaw: openMatch[1], lines: [], index: widgetCount++ };
      continue;
    }

    if (/^```/.test(line)) inOtherFence = !inOtherFence;
    mdBuf.push(line);
  }

  if (active) {
    const meta = parseMeta(active.metaRaw, active.index);
    segments.push({
      type: "gen-ui",
      block: {
        id: `gen-ui-${active.index}`,
        title: meta.title,
        kind: meta.kind,
        height: meta.height,
        html: active.lines.join("\n").trim(),
        streaming: true,
      },
    });
  }
  flushMd();
  return segments;
}

const EGRESS_PATTERNS: readonly [RegExp, string][] = [
  [/<script\b[^>]*\bsrc\s*=/i, "External <script src> is blocked in offline sandbox"],
  [/<link\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:|\/\/)/i, "External stylesheet/link is blocked in offline sandbox"],
  [/<iframe\b/i, "Nested <iframe> is blocked in offline sandbox"],
  [/<object\b|<embed\b/i, "Plugin <object>/<embed> is blocked in offline sandbox"],
  [/<form\b[^>]*\baction\s*=\s*["']?\s*(?:https?:|\/\/)/i, "External form submission is blocked"],
  [/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/i, "Network API calls are blocked in offline sandbox"],
  [/@import\s+(?:url\s*\()?["']?\s*(?:https?:|\/\/)/i, "External CSS @import is blocked"],
];

const ESCAPE_PATTERNS: readonly [RegExp, string][] = [
  [/\b(?:window|self|globalThis)\s*\.\s*(?:top|parent)\s*\.\s*(?:location|document|localStorage|sessionStorage)/i, "Parent frame access is blocked"],
  [/\btop\s*\.\s*location\b/i, "Top-frame navigation is blocked"],
  [/\bdocument\s*\.\s*cookie\b/i, "Cookie access is blocked"],
  [/<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i, "Meta refresh redirects are blocked"],
];

/** Validate generated widget HTML before rendering. Blocks external network egress and frame-escape patterns. */
export function validateGenUiHtml(html: string): GenUiValidation {
  const trimmed = html.trim();
  if (!trimmed) return { ok: false, code: "empty", reason: "Empty widget markup" };
  if (trimmed.length > MAX_GEN_UI_BYTES) {
    return { ok: false, code: "too-large", reason: `Widget exceeds ${Math.round(MAX_GEN_UI_BYTES / 1000)} KB limit` };
  }
  for (const [re, reason] of EGRESS_PATTERNS) {
    if (re.test(trimmed)) return { ok: false, code: "egress", reason };
  }
  for (const [re, reason] of ESCAPE_PATTERNS) {
    if (re.test(trimmed)) return { ok: false, code: "escape", reason };
  }
  return { ok: true };
}

export function clampHeight(h: number): number {
  if (!Number.isFinite(h)) return DEFAULT_GEN_UI_HEIGHT;
  return Math.max(MIN_GEN_UI_HEIGHT, Math.min(MAX_GEN_UI_HEIGHT, Math.round(h)));
}

/** Build the complete offline-sandboxed HTML5 srcDoc with ORBIT's dark glassmorphic theme tokens and nonce postMessage bridge. */
export function buildGenUiSrcDoc(html: string, nonce: string): string {
  const safeNonce = JSON.stringify(nonce.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="${GEN_UI_CSP}" />
<style>
:root {
  color-scheme: dark;
  --bg: #070b14;
  --surface: rgba(15, 23, 42, 0.72);
  --surface-2: rgba(30, 41, 59, 0.55);
  --border: rgba(148, 163, 184, 0.18);
  --text: #e2e8f0;
  --muted: #94a3b8;
  --accent: #38bdf8;
  --accent-2: #818cf8;
  --ok: #34d399;
  --warn: #fbbf24;
  --danger: #f87171;
  --radius: 10px;
  --font: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: var(--font); font-size: 14px; line-height: 1.45; }
body { padding: 14px; overflow-x: auto; }
button, input, select { font: inherit; color: var(--text); }
button { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px; cursor: pointer; }
button:hover { border-color: var(--accent); }
input[type="range"] { accent-color: var(--accent); }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
th { color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; }
</style>
<script>
(function(){
  var NONCE = ${safeNonce};
  function send(payload) {
    try { window.parent.postMessage(Object.assign({ __orbitUi: NONCE }, payload), "*"); } catch (e) {}
  }
  function reportHeight() {
    var h = Math.max(document.documentElement.scrollHeight || 0, document.body ? document.body.scrollHeight : 0);
    if (h > 0) send({ type: "resize", height: h + 8 });
  }
  window.orbitUi = Object.freeze({
    resize: reportHeight,
    copy: function(text) { send({ type: "copy", text: String(text || "").slice(0, 16000) }); },
    ask: function(prompt) { send({ type: "ask", prompt: String(prompt || "").slice(0, 1000) }); },
    navigate: function(target) { send({ type: "navigate", target: String(target || "").slice(0, 80) }); }
  });
  window.addEventListener("load", reportHeight);
  if (typeof ResizeObserver === "function") {
    window.addEventListener("DOMContentLoaded", function() {
      try { new ResizeObserver(reportHeight).observe(document.body); } catch (e) {}
      reportHeight();
    });
  }
})();
</script>
</head>
<body>
${html}
</body>
</html>`;
}

const ALLOWED_NAV_TARGETS = new Set([
  "CORE", "MEMORY", "INTELLIGENCE", "AGENTS", "OPERATIONS", "STUDIO", "CREATION", "BUSINESS", "LIFE", "VAULT", "ANALYTICS", "ARCH",
]);

/** Validate and normalize a postMessage event sent from a sandboxed GenUI iframe. */
export function parseGenUiMessage(data: unknown, expectedNonce: string): GenUiAction | null {
  if (!data || typeof data !== "object") return null;
  const rec = data as Record<string, unknown>;
  if (!expectedNonce || rec.__orbitUi !== expectedNonce) return null;
  if (rec.type === "resize" && typeof rec.height === "number" && Number.isFinite(rec.height)) {
    return { type: "resize", height: clampHeight(rec.height) };
  }
  if (rec.type === "copy" && typeof rec.text === "string" && rec.text.length > 0) {
    return { type: "copy", text: rec.text.slice(0, 16_000) };
  }
  if (rec.type === "ask" && typeof rec.prompt === "string" && rec.prompt.trim().length > 0) {
    return { type: "ask", prompt: rec.prompt.trim().slice(0, 1_000) };
  }
  if (rec.type === "navigate" && typeof rec.target === "string") {
    const up = rec.target.trim().toUpperCase();
    if (ALLOWED_NAV_TARGETS.has(up)) return { type: "navigate", target: up };
  }
  return null;
}
