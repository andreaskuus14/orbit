// Approve / Reject from the phone's ntfy notification (http action buttons → POST /api/remote/ntfy-act). Pure; tested in
// tests/ntfy-action.test.ts; IO: ntfy-action.ts. One token per waiting task: HMAC-SHA256 with a server secret, 24 h, used once (for
// whichever button is pressed first). Only a task with ONE waiting action whose effect is not send/spend/publish/sign gets buttons;
// anything consequential (or unknown) gets only Open, so its exact content is read before his click (AGENTS.md rule 6).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isConsequential } from "./approval-pure.ts";

export const TOKEN_MS = 24 * 3600_000;
export type ActToken = { t: string; u: string; e: number; n: string; s?: string }; // task, user, expires (ms), nonce, seen (S02 fingerprint of the action in the notification)
export type PhoneAct = "approve" | "reject";
const b64 = (b: Buffer) => b.toString("base64url");
const mac = (secret: Buffer, body: string) => createHmac("sha256", secret).update(body).digest();

export function signAct(secret: Buffer, taskId: string, userId: string, now: number, nonce = b64(randomBytes(12)), seen?: string): string {
  const body = b64(Buffer.from(JSON.stringify({ t: taskId, u: userId, e: now + TOKEN_MS, n: nonce, ...(seen ? { s: seen } : {}) } satisfies ActToken)));
  return `${body}.${b64(mac(secret, body))}`;
}

/** The token's claims, or why it is refused. `used`: nonces already spent (one use). */
export function verifyAct(secret: Buffer, token: unknown, now: number, used: Record<string, number>): ActToken | { error: string } {
  if (typeof token !== "string" || token.length > 600) return { error: "bad token" };
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return { error: "bad token" };
  const want = mac(secret, body), got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { error: "bad token" };
  let c: Partial<ActToken>;
  try { c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return { error: "bad token" }; }
  if (typeof c.t !== "string" || typeof c.u !== "string" || typeof c.n !== "string" || !Number.isFinite(c.e) || (c.s !== undefined && typeof c.s !== "string")) return { error: "bad token" };
  if (c.e! <= now) return { error: "This button expired (24 h). Open ORBIT to decide." };
  if (c.n in used) return { error: "Already answered from this notification." };
  return c as ActToken;
}

/** Spend a nonce (mutates); expired ones are dropped so the list stays small. */
export function markUsed(used: Record<string, number>, n: string, exp: number, now: number): Record<string, number> {
  for (const [k, e] of Object.entries(used)) if (e <= now) delete used[k];
  used[n] = exp;
  return used;
}

/** Buttons only for a single waiting action that sends, spends, publishes or signs nothing. */
export function phoneActionable(pending: unknown): boolean {
  const waiting = (Array.isArray(pending) ? pending : []).filter((p) => p && (p as { status?: unknown }).status === "pending");
  return waiting.length === 1 && typeof waiting[0].tool === "string" && !isConsequential(waiting[0].tool);
}

export const isPhoneAct = (a: unknown): a is PhoneAct => a === "approve" || a === "reject";
