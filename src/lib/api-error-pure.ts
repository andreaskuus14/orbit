// Safe failure handling for API routes and fetches: what a route sends back when something throws, and what goes to the log.
// Rules: always JSON, never a stack, never a secret or a full file path, and for LIFE/journal routes no error details at all
// (an error message can echo the text that was being saved).

export type FailKind = "timeout" | "offline" | "internal";
type Env = Record<string, string | undefined>;
const ENV = (): Env => (globalThis as { process?: { env?: Env } }).process?.env ?? {};

const errChain = (e: unknown): { name: string; code: string; text: string } => {
  const parts: string[] = [], codes: string[] = [], names: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    const o = cur as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };
    if (typeof o.name === "string") names.push(o.name);
    if (typeof o.code === "string") codes.push(o.code);
    parts.push(typeof o.message === "string" ? o.message : typeof cur === "string" ? cur : "");
    cur = o.cause;
  }
  return { name: names.join(" "), code: codes.join(" "), text: parts.join(" ") };
};

/** timeout: an abort or deadline; offline: a service or the network didn't answer (Ollama off, Supabase down, no Wi-Fi). */
export function classifyError(e: unknown): FailKind {
  const { name, code, text } = errChain(e);
  if (/\b(AbortError|TimeoutError)\b/.test(name) || /UND_ERR_(HEADERS|BODY|CONNECT)_TIMEOUT|ETIMEDOUT/.test(code)) return "timeout";
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|ENETUNREACH|UND_ERR_SOCKET/.test(code)) return "offline";
  if (/\bfetch failed\b|Failed to fetch|NetworkError|AuthRetryableFetchError/i.test(`${name} ${text}`)) return "offline";
  return "internal";
}

const SECRET_KEY = /KEY|SECRET|TOKEN|PASSWORD|PASS\b|CREDENTIAL|PRIVATE/i;

/** Remove secrets, stacks and absolute paths from one message; first line only, capped. */
export function redactMessage(s: string, env: Env = {}): string {
  let out = String(s ?? "").split(/\r?\n\s*at\s/)[0].split(/\r?\n/)[0];
  for (const [k, v] of Object.entries(env)) if (v && v.length >= 8 && SECRET_KEY.test(k)) out = out.split(v).join("[hidden]");
  out = out
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[hidden]")
    .replace(/\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{8,}/g, "[hidden]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[hidden]")
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [hidden]")
    .replace(/([?&](?:key|token|secret|apikey|api_key|access_token)=)[^&\s"']+/gi, "$1[hidden]")
    .replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, "//[hidden]@")
    .replace(/\b[A-Za-z]:\\[^\s"'<>|]+/g, "[path]")
    .replace(/(^|[\s"'(])\/(?:home|Users|root|tmp|var|opt|mnt|srv)\/[^\s"')]+/g, "$1[path]");
  return out.length > 300 ? out.slice(0, 297) + "..." : out;
}

/** Which service a network failure points at, so the message can name it. */
function service(e: unknown, env: Env): "ollama" | "supabase" | null {
  const { text } = errChain(e);
  if (/11434|ollama/i.test(text)) return "ollama";
  const sb = env.NEXT_PUBLIC_SUPABASE_URL;
  if (/supabase/i.test(text) || (sb && text.includes(sb))) return "supabase";
  return null;
}

export const TEXT = {
  timeout: "That took too long. Try again.",
  offline: "Something ORBIT needs isn't answering (network, Supabase or Ollama). Try again in a minute.",
  ollama: "The local model (Ollama) isn't answering. Start it, or try again in a minute.",
  supabase: "Can't reach the database (Supabase) right now. Try again in a minute.",
  internal: "Something went wrong. Try again.",
} as const;

/** The JSON a route sends when a handler threw. Unknown errors never expose their raw message. */
export function errorResponse(e: unknown, env: Env = {}): { status: number; body: { error: string; kind: FailKind } } {
  const kind = classifyError(e);
  if (kind === "timeout") return { status: 504, body: { error: TEXT.timeout, kind } };
  if (kind === "offline") { const s = service(e, env); return { status: 503, body: { error: s ? TEXT[s] : TEXT.offline, kind } }; }
  return { status: 500, body: { error: TEXT.internal, kind } };
}

/** Drop-in for `e instanceof Error ? e.message : fallback` in routes that show their own messages: same message, made safe. */
export function safeMessage(e: unknown, fallback: string, env: Env = ENV()): string {
  const kind = classifyError(e);
  if (kind !== "internal") return errorResponse(e, env).body.error;
  if (!(e instanceof Error) || !e.message) return fallback;
  return redactMessage(e.message, env) || fallback;
}

/** Routes that handle LIFE / journal text: their failures log only the kind, never a message. */
export const isPrivateRoute = (name: string): boolean => /(^|\/)(life|journal|diary|evening|capsule|dream)(\/|$)/i.test(name);

/** One log line for a failed route: no stack, redacted, no details at all for private routes. */
export function logLine(name: string, e: unknown, env: Env = {}): string {
  const kind = classifyError(e);
  if (isPrivateRoute(name)) return `[orbit] api ${name} failed (${kind}; details hidden: private route)`;
  const { name: n } = errChain(e);
  const msg = e instanceof Error ? redactMessage(e.message, env) : typeof e === "string" ? redactMessage(e, env) : "";
  return `[orbit] api ${name} failed (${kind}): ${n.split(" ")[0] || "Error"}${msg ? `: ${msg}` : ""}`;
}

/** Supabase request deadline: storage uploads get longer (a big file), everything else fails fast. */
export const supabaseTimeoutMs = (url: string, method = "GET"): number =>
  /\/storage\/v1\/object\//.test(url) && /^(POST|PUT)$/i.test(method) ? 120_000 : 20_000;

/** supabase.auth.getUser failed because Supabase couldn't be reached (not because nobody is signed in). */
export function authUnreachable(err: unknown): boolean {
  if (!err) return false;
  const o = err as { name?: unknown; status?: unknown };
  if (o.name === "AuthRetryableFetchError") return true;
  if (typeof o.status === "number" && (o.status === 0 || o.status >= 500)) return true;
  return classifyError(err) !== "internal";
}

/** A signal that aborts after ms, joined with the caller's own signal when there is one. */
export function timeoutSignal(ms: number, signal?: AbortSignal | null): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}
