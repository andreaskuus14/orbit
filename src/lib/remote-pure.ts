// iPhone remote over the tailnet: pairing codes, HMAC session tokens, strict command parsing. Tested in tests/remote.test.ts.
// Pure: the secret, clock and randomness are always parameters (never env). No route/UI here.
// Safety: no command spends or sends anything. `approve` only acts on an existing approval record, and is marked
// requiresOwnerConfirm so the PC-side handler re-checks it against that pending approval before acting.
import { createHmac, timingSafeEqual } from "node:crypto";

// ---- Pairing -------------------------------------------------------------

export const PAIR_TTL_MS = 2 * 60 * 1000;
export const PAIR_MAX_FAILS = 5;
export type PairCode = { code: string; expiresAt: number; fails: number; used: boolean };
export type PairResult = { ok: true; pair: PairCode } | { ok: false; reason: "expired" | "locked" | "used" | "wrong"; pair: PairCode };

/** `rand(n)` must return a cryptographically random integer in [0, n), e.g. node:crypto randomInt. */
export function makePairCode(rand: (n: number) => number, now: number = Date.now()): PairCode {
  const n = rand(1_000_000);
  if (!Number.isInteger(n) || n < 0 || n >= 1_000_000) throw new Error("rand(n) must return an integer in [0, n).");
  return { code: String(n).padStart(6, "0"), expiresAt: now + PAIR_TTL_MS, fails: 0, used: false };
}

const sameBytes = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Check an attempt; returns the next pair state to store. Locks after 5 wrong tries; one success consumes the code. */
export function verifyPair(pair: PairCode, attempt: unknown, now: number): PairResult {
  if (pair.used) return { ok: false, reason: "used", pair };
  if (pair.fails >= PAIR_MAX_FAILS) return { ok: false, reason: "locked", pair };
  if (now >= pair.expiresAt) return { ok: false, reason: "expired", pair };
  const guess = typeof attempt === "string" && /^\d{6}$/.test(attempt) ? attempt : "------";
  if (sameBytes(pair.code, guess)) return { ok: true, pair: { ...pair, used: true } };
  const next = { ...pair, fails: pair.fails + 1 };
  return { ok: false, reason: next.fails >= PAIR_MAX_FAILS ? "locked" : "wrong", pair: next };
}

// ---- Session tokens ------------------------------------------------------

export type TokenPayload = { deviceId: string; issuedAt: number; exp: number };
export type TokenResult = { ok: true; payload: TokenPayload } | { ok: false; error: string };
const MIN_SECRET_BYTES = 32;
const CLOCK_SKEW_MS = 60_000;
const DEVICE_ID = /^[A-Za-z0-9_-]{1,128}$/;

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest();

function checkSecret(secret: string) {
  if (typeof secret !== "string" || Buffer.byteLength(secret) < MIN_SECRET_BYTES) throw new Error(`Token secret must be at least ${MIN_SECRET_BYTES} bytes.`);
}

function validPayload(p: unknown): p is TokenPayload {
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  const o = p as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(",");
  return keys === "deviceId,exp,issuedAt" && typeof o.deviceId === "string" && DEVICE_ID.test(o.deviceId)
    && Number.isSafeInteger(o.issuedAt) && Number.isSafeInteger(o.exp) && (o.exp as number) > (o.issuedAt as number);
}

/** `base64url(json).base64url(HMAC-SHA256)` over the exact JSON body. */
export function signToken(payload: TokenPayload, secret: string): string {
  checkSecret(secret);
  if (!validPayload(payload)) throw new Error("Bad token payload.");
  const body = b64u(JSON.stringify({ deviceId: payload.deviceId, issuedAt: payload.issuedAt, exp: payload.exp }));
  return `${body}.${b64u(mac(body, secret))}`;
}

export function verifyToken(token: unknown, secret: string, now: number): TokenResult {
  checkSecret(secret);
  if (typeof token !== "string" || token.length > 1024) return { ok: false, error: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return { ok: false, error: "malformed" };
  const want = mac(parts[0], secret);
  const got = Buffer.from(parts[1], "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, error: "bad signature" };
  let p: unknown;
  try { p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return { ok: false, error: "malformed" }; }
  if (!validPayload(p)) return { ok: false, error: "malformed" };
  if (now >= p.exp) return { ok: false, error: "expired" };
  if (p.issuedAt > now + CLOCK_SKEW_MS) return { ok: false, error: "issued in the future" };
  return { ok: true, payload: p };
}

// ---- Commands ------------------------------------------------------------

export const REMOTE_PANELS = ["core", "profile", "memory", "intelligence", "creation", "operations", "agents", "life", "vault", "analytics", "studio", "theater", "markets", "business", "arch"] as const;
export type RemotePanel = (typeof REMOTE_PANELS)[number];
export const MAX_COMMAND_BYTES = 8 * 1024;
export const MAX_ASK_CHARS = 2000;
export const NONCE_CACHE_SIZE = 500;

export type RemoteCommand =
  | { type: "navigate"; nonce: string; panel: RemotePanel }
  | { type: "core.ask"; nonce: string; text: string }
  | { type: "approval.list"; nonce: string }
  | { type: "approve"; nonce: string; id: string; requiresOwnerConfirm: true }
  | { type: "reject"; nonce: string; id: string }
  | { type: "stopAll"; nonce: string }
  | { type: "status"; nonce: string };
export type CommandResult = { ok: true; cmd: RemoteCommand } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONCE = /^[A-Za-z0-9_-]{16,64}$/;
const FIELDS: Record<RemoteCommand["type"], string[]> = {
  navigate: ["panel"], "core.ask": ["text"], "approval.list": [], approve: ["id"], reject: ["id"], stopAll: [], status: [],
};

/** Bounded LRU of seen nonces (oldest evicted first). */
export class NonceCache {
  private seen = new Map<string, true>();
  private readonly max: number;
  constructor(max: number = NONCE_CACHE_SIZE) { this.max = max; }
  has(n: string) { return this.seen.has(n); }
  add(n: string) {
    this.seen.delete(n);
    this.seen.set(n, true);
    if (this.seen.size > this.max) this.seen.delete(this.seen.keys().next().value as string);
  }
  get size() { return this.seen.size; }
}

/** Validate one command from the phone. Unknown types/fields, oversize payloads and replayed nonces are rejected. */
export function parseCommand(json: unknown, nonces: NonceCache): CommandResult {
  if (typeof json !== "string") return { ok: false, error: "payload must be a JSON string" };
  if (Buffer.byteLength(json) > MAX_COMMAND_BYTES) return { ok: false, error: "payload over 8 KB" };
  let v: unknown;
  try { v = JSON.parse(json); } catch { return { ok: false, error: "invalid JSON" }; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "payload must be an object" };
  const o = v as Record<string, unknown>;
  const type = o.type;
  if (typeof type !== "string" || !Object.hasOwn(FIELDS, type)) return { ok: false, error: "unknown command type" };
  const allowed = new Set(["type", "nonce", ...FIELDS[type as RemoteCommand["type"]]]);
  const extra = Object.keys(o).filter((k) => !allowed.has(k));
  if (extra.length) return { ok: false, error: `unknown field: ${extra[0]}` };
  const nonce = o.nonce;
  if (typeof nonce !== "string" || !NONCE.test(nonce)) return { ok: false, error: "bad nonce" };

  let cmd: RemoteCommand;
  switch (type) {
    case "navigate":
      if (typeof o.panel !== "string" || !(REMOTE_PANELS as readonly string[]).includes(o.panel)) return { ok: false, error: "unknown panel" };
      cmd = { type, nonce, panel: o.panel as RemotePanel };
      break;
    case "core.ask":
      if (typeof o.text !== "string" || !o.text.trim()) return { ok: false, error: "text required" };
      if (o.text.length > MAX_ASK_CHARS) return { ok: false, error: `text over ${MAX_ASK_CHARS} chars` };
      cmd = { type, nonce, text: o.text };
      break;
    case "approve":
    case "reject":
      if (typeof o.id !== "string" || !UUID.test(o.id)) return { ok: false, error: "id must be a uuid" };
      cmd = type === "approve" ? { type, nonce, id: o.id.toLowerCase(), requiresOwnerConfirm: true } : { type, nonce, id: o.id.toLowerCase() };
      break;
    default:
      cmd = { type: type as "approval.list" | "stopAll" | "status", nonce };
  }
  // Checked last so a rejected command does not burn its nonce, but before returning ok so a replay never passes.
  if (nonces.has(nonce)) return { ok: false, error: "replayed nonce" };
  nonces.add(nonce);
  return { ok: true, cmd };
}
