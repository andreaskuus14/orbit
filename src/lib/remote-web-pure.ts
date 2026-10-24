// iPhone remote (roadmap 6.2): the decisions around remote-pure.ts's protocol. Pure, tested in tests/remote-web.test.ts.
// Server glue: remote.ts; routes: /api/remote/*; page: /remote.
import { createHmac } from "node:crypto";
import type { RemoteCommand } from "./remote-pure.ts";

export const REMOTE_COOKIE = "orbit_remote";
export const REMOTE_TOKEN_DAYS = 30;
export const MAX_REMOTE_BODY = 9 * 1024; // the 8 KB command string plus its JSON envelope and echo
export const RATE = { cmd: { limit: 30, windowMs: 60_000 }, ask: { limit: 6, windowMs: 60_000 }, pair: { limit: 10, windowMs: 60_000 } } as const;

/** "" when REMOTE_SECRET can sign tokens, else the message the PC and phone show. */
export function secretProblem(secret: string | undefined): string {
  if (!secret) return "Phone remote is off: set REMOTE_SECRET in .env.local (at least 32 random characters) and restart ORBIT.";
  if (Buffer.byteLength(secret) < 32) return "Phone remote is off: REMOTE_SECRET must be at least 32 bytes.";
  return "";
}

/** HttpOnly so page script can't read the token; Strict + path so it only rides on same-site calls to /api/remote. */
export function cookieOptions(https: boolean, maxAgeSec = REMOTE_TOKEN_DAYS * 86_400) {
  return { httpOnly: true, secure: https, sameSite: "strict" as const, path: "/api/remote", maxAge: maxAgeSec };
}

/** Sliding window: keep the hits inside the window; ok when there is room for one more (which is then recorded). */
export function takeRate(hits: readonly number[], now: number, limit: number, windowMs: number): { ok: boolean; hits: number[] } {
  const live = hits.filter((t) => t > now - windowMs);
  if (live.length >= limit) return { ok: false, hits: live };
  return { ok: true, hits: [...live, now] };
}

export type RemoteAction = "status" | "approvals" | "approve" | "reject" | "stopAll" | "ask" | "unsupported";
/** Command → what the server does. navigate would steer the PC screen, which the phone page doesn't offer. */
export function actionFor(cmd: RemoteCommand): RemoteAction {
  switch (cmd.type) {
    case "status": return "status";
    case "approval.list": return "approvals";
    case "approve": return "approve";
    case "reject": return "reject";
    case "stopAll": return "stopAll";
    case "core.ask": return "ask";
    default: return "unsupported";
  }
}

// ---- Approvals -------------------------------------------------------------

export type ApprovalKind = "clip" | "spend" | "send";
/** One item already waiting for the owner. key is internal ("clip:<job>/<clip>", "spend:<story>", "send:<prospect uuid>"). */
export type Approval = {
  id: string; key: string; kind: ApprovalKind; title: string; detail: string;
  credits?: number; // spend: the exact quoted total
  seen?: string; to?: string; message?: string; // send: the draft's updated_at, recipient and full text
};
export type Echo = { kind: ApprovalKind; credits?: number; seen?: string } | { on: boolean };

/** The uuid the phone uses for an item: HMAC of its key, so ids can't be guessed or pointed at things that aren't listed. */
export function approvalId(key: string, secret: string): string {
  const h = createHmac("sha256", secret).update(`approval:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const keysAre = (o: Record<string, unknown>, allowed: string[]) => Object.keys(o).every((k) => allowed.includes(k));

/** Validate the echo that rides with a command: approve/reject echo what the owner saw, stopAll echoes the state it flips. */
export function parseEcho(cmd: RemoteCommand, raw: unknown): { ok: true; echo: Echo | null } | { ok: false; error: string } {
  const needs = cmd.type === "approve" || cmd.type === "reject" ? "item" : cmd.type === "stopAll" ? "stop" : null;
  if (!needs) return raw === undefined ? { ok: true, echo: null } : { ok: false, error: "this command takes no echo" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "echo required" };
  const o = raw as Record<string, unknown>;
  if (needs === "stop") {
    if (!keysAre(o, ["on"]) || typeof o.on !== "boolean") return { ok: false, error: "echo must be {on}" };
    return { ok: true, echo: { on: o.on } };
  }
  if (!keysAre(o, ["kind", "credits", "seen"]) || !["clip", "spend", "send"].includes(o.kind as string)) return { ok: false, error: "echo.kind required" };
  if (o.credits !== undefined && (typeof o.credits !== "number" || !Number.isFinite(o.credits) || o.credits < 0)) return { ok: false, error: "echo.credits must be a number" };
  if (o.seen !== undefined && (typeof o.seen !== "string" || o.seen.length > 64)) return { ok: false, error: "echo.seen must be a string" };
  return { ok: true, echo: { kind: o.kind as ApprovalKind, credits: o.credits as number | undefined, seen: o.seen as string | undefined } };
}

/** "" when the echo matches the item as it is NOW (exact kind, exact credits for a spend, exact draft version for a send). */
export function echoProblem(item: Approval | undefined, echo: Echo | null, action: "approve" | "reject"): string {
  if (!item) return "That item is no longer waiting for approval: reload";
  if (!echo || !("kind" in echo) || echo.kind !== item.kind) return "That item changed: reload";
  if (action === "reject" && item.kind !== "clip") return "Only clips can be rejected from the phone";
  if (action === "approve" && item.kind === "spend" && (typeof item.credits !== "number" || echo.credits !== item.credits)) return `The quote is now ${item.credits} credits: reload and check it`;
  if (action === "approve" && item.kind === "send" && (!item.seen || echo.seen !== item.seen)) return "The draft changed since you read it: reload";
  return "";
}

/** Ledger payload for one remote command: its type, outcome and device; never message text or item contents. */
export const ledgerData = (cmd: { type: string } | null, ok: boolean, device: string) => ({ command: cmd?.type ?? "invalid", ok, device });

/** A device name the owner sees in the paired list. */
export const deviceName = (v: unknown) => (typeof v === "string" ? v.replace(/[^\p{L}\p{N} '._-]/gu, "").trim().slice(0, 40) : "") || "iPhone";
