// Apple Watch / iPhone Shortcuts (roadmap D4): per-shortcut tokens, the one-line status, and the approve-next challenge whose
// code (and, for a spend, exact credits) he speaks or types back. Pure; tested in tests/remote-shortcut.test.ts.
// Server glue: remote-shortcut.ts; route: /api/remote/shortcut; owner setup: docs/PHONE.md "Shortcuts & Watch".
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Approval, Echo } from "./remote-web-pure.ts";

/** One token = one action: a leaked "status" token can't approve or stop anything. */
export const SHORTCUT_ACTIONS = ["status", "call", "stop", "approve", "ask"] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];
export type Shortcut = { id: string; name: string; action: ShortcutAction; userId: string; hash: string; createdAt: string };
export const SHORTCUT_RATE = { limit: 20, windowMs: 60_000 } as const;
export const CHALLENGE_MS = 2 * 60_000;
export const CHALLENGE_TRIES = 3;
const TOKEN = /^orbit_sc_[A-Za-z0-9_-]{43}$/;

export const isShortcutAction = (v: unknown): v is ShortcutAction => (SHORTCUT_ACTIONS as readonly unknown[]).includes(v);
/** `bytes` must be 32 cryptographically random bytes. The token is shown once; only its HMAC is stored. */
export function newShortcutToken(bytes: Uint8Array): string {
  if (bytes.length !== 32) throw new Error("need 32 random bytes");
  return `orbit_sc_${Buffer.from(bytes).toString("base64url")}`;
}
/** Keyed by REMOTE_SECRET, so changing it revokes every Shortcut, as it unpairs every phone. */
export const shortcutHash = (token: string, secret: string) => createHmac("sha256", secret).update(`shortcut:${token}`).digest("hex");

/** The Shortcut behind an `Authorization: Bearer <token>` header, or null. */
export function findShortcut(list: readonly Shortcut[], authorization: string | null, secret: string): Shortcut | null {
  const m = /^Bearer (\S+)$/.exec(authorization ?? "");
  if (!m || !TOKEN.test(m[1])) return null;
  const want = Buffer.from(shortcutHash(m[1], secret));
  return list.find((s) => { const got = Buffer.from(s.hash); return got.length === want.length && timingSafeEqual(got, want); }) ?? null;
}

export const shortcutName = (v: unknown) => (typeof v === "string" ? v.replace(/[^\p{L}\p{N} '._-]/gu, "").trim().slice(0, 40) : "") || "Shortcut";

// ---- Status ---------------------------------------------------------------

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
/** One line Siri can read: Stop-all, what's waiting (kinds and counts only, never titles), what's running. */
export function statusLine(s: { stopOn: boolean; kinds: readonly Approval["kind"][]; running: number }): string {
  const n = (k: Approval["kind"]) => s.kinds.filter((x) => x === k).length;
  const parts = [[n("clip"), "clip"], [n("spend"), "spend"], [n("send"), "email"]].filter(([c]) => c).map(([c, w]) => plural(c as number, w as string));
  const waiting = s.kinds.length ? `${s.kinds.length} waiting for you: ${parts.join(", ")}.` : "Nothing waiting for you.";
  return `${s.stopOn ? "Stop-all is ON." : "ORBIT is running."} ${waiting}${s.running ? ` ${plural(s.running, "job")} running.` : ""}`;
}

// ---- Approve next ---------------------------------------------------------

/** What the watch may approve: clips with a preview and spends. Email drafts stay in Remote, where the full message is shown. */
export const watchApprovable = (a: Approval) => a.kind === "spend" || (a.kind === "clip" && !!a.thumb);

export type Challenge = { shortcutId: string; id: string; kind: Approval["kind"]; seen: string; code: string; expiresAt: number; tries: number };
/** `rand(n)` must be a cryptographic random integer in [0, n). */
export function makeChallenge(shortcutId: string, item: Approval, rand: (n: number) => number, now: number): Challenge {
  return { shortcutId, id: item.id, kind: item.kind, seen: item.seen, code: String(rand(10_000)).padStart(4, "0"), expiresAt: now + CHALLENGE_MS, tries: 0 };
}
/** What the Shortcut speaks: the exact item, its credits for a spend, and the code to say back. Digits spaced so Siri reads them one by one. */
export function challengeLine(item: Approval, code: string): string {
  const said = code.split("").join(" ");
  if (item.kind === "spend") return `Approve the Higgsfield spend for "${item.title}", ${item.credits} credits? To confirm, say ${said} and then ${item.credits}.`;
  return `Approve the clip "${item.title}"? To confirm, say ${said}.`;
}

/** "4 8 2 1 120" / "4821, 1,200 credits" → code and credits. The code is always 4 digits, so the digits after it are the credits
 *  (dictation spaces or groups digits unpredictably; only the digit order is reliable). */
export function parseReply(v: unknown): { code: string; credits?: number } | null {
  if (typeof v !== "string" || v.length > 200) return null;
  const d = v.replace(/\D/g, "");
  if (d.length < 4 || d.length > 13) return null;
  return d.length > 4 ? { code: d.slice(0, 4), credits: Number(d.slice(4)) } : { code: d };
}

export type ChallengeCheck = { ok: true; id: string; echo: Echo } | { ok: false; error: string; next: Challenge | null };
/** Code right and in time → the echo decideApproval checks (exact version; for a spend, the credits HE said, which must equal the quote).
 *  The challenge is single-use and dies after 3 wrong replies. */
export function checkReply(ch: Challenge | null, reply: unknown, now: number): ChallengeCheck {
  if (!ch || now >= ch.expiresAt) return { ok: false, error: "No approval is waiting for a code: run the shortcut again.", next: null };
  const r = parseReply(reply);
  const good = r && timingSafeEqual(Buffer.from(r.code), Buffer.from(ch.code)); // both exactly 4 ASCII digits
  if (!r || !good) {
    const next = { ...ch, tries: ch.tries + 1 };
    return next.tries >= CHALLENGE_TRIES ? { ok: false, error: "Wrong code three times: cancelled.", next: null } : { ok: false, error: "Wrong code. Nothing approved.", next };
  }
  if (ch.kind === "spend" && r.credits === undefined) return { ok: false, error: "Say the code and then the credits. Nothing approved.", next: ch };
  return { ok: true, id: ch.id, echo: { kind: ch.kind, seen: ch.seen, ...(ch.kind === "spend" ? { credits: r.credits } : {}) } };
}

// ---- Ask CORE -------------------------------------------------------------

/** CORE's answer as something Siri can read on a watch: no markdown or links, at most ~max chars, cut at a sentence. */
export function speakable(text: string, max = 400): string {
  const t = text.replace(/```[\s\S]*?```/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, "").replace(/[*_#>`|]/g, "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t || "CORE had no answer.";
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > max / 3 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
}
