// Phone notifications through ntfy (https://ntfy.sh, free, self-hostable), next to Web Push (remote-push-pure.ts). Pure; tested in
// tests/ntfy.test.ts; IO: ntfy.ts. Privacy: the topic is the only secret (anyone who knows it can read it), so a message carries
// fixed labels, counts and a receipt status only — never a task title, email text, memory or LIFE/journal data.
import { quietAt, type PushMessage, type Quiet } from "./remote-push-pure.ts";
import type { ReceiptStatus } from "./receipt-pure.ts";

export type NtfyConfig = { server: string; topic: string; open: string; quiet: Quiet };
// acts: http buttons (Approve / Reject) that POST `body` to `url` (ntfy-action-pure.ts decides which items may have them).
export type NtfyMsg = { title: string; message: string; tags: string[]; priority: 2 | 3 | 4; click?: string; kind: string; acts?: { label: string; url: string; body: string }[] };
export const MIN_TOPIC = 16; // a short topic on the public server is guessable

/** ORBIT_NTFY_URL (empty = https://ntfy.sh), ORBIT_NTFY_TOPIC (empty = off), ORBIT_NTFY_OPEN_URL (his Tailscale address of ORBIT,
 *  e.g. https://orbit-pc.tailnet.ts.net:3000; empty = no Open link). → config, a problem line for the owner, or "off". */
export function ntfyConfig(env: Record<string, string | undefined>, quiet: Quiet): NtfyConfig | { problem: string } | null {
  const topic = (env.ORBIT_NTFY_TOPIC ?? "").trim();
  if (!topic) return null;
  if (!/^[\w-]{1,64}$/.test(topic)) return { problem: "ORBIT_NTFY_TOPIC may use letters, digits, - and _ only (max 64)" };
  if (topic.length < MIN_TOPIC) return { problem: `ORBIT_NTFY_TOPIC is too short to be private: use ${MIN_TOPIC}+ random characters` };
  const url = (s: string | undefined, dflt: string) => { try { const u = new URL((s ?? "").trim() || dflt); return u.protocol === "https:" || u.protocol === "http:" ? u.origin + u.pathname.replace(/\/+$/, "") : ""; } catch { return ""; } };
  const server = url(env.ORBIT_NTFY_URL, "https://ntfy.sh");
  if (!server) return { problem: "ORBIT_NTFY_URL is not an http(s) address" };
  return { server, topic, open: env.ORBIT_NTFY_OPEN_URL?.trim() ? url(env.ORBIT_NTFY_OPEN_URL, "") : "", quiet };
}

const URGENT = ["failed", "stop"];
/** Stop-all: only the "Stop-all is ON" notice itself. Quiet hours: failures and Stop-all still go (same rule as Web Push). */
export const ntfyAllowed = (kind: string, now: number, quiet: Quiet, stopAll: boolean) => (stopAll ? kind === "stop" : URGENT.includes(kind) || !quietAt(now, quiet));

const click = (open: string, anchor: string) => (open ? `${open}${anchor}` : undefined);

/** A Web Push label (already fixed text + count, see pushLabel) as an ntfy message; its /remote deep link becomes the Open click. */
export function fromPush(m: PushMessage, open: string): NtfyMsg {
  return { kind: m.tag, title: m.title, message: m.body, tags: [URGENT.includes(m.tag) ? "warning" : "bell"], priority: URGENT.includes(m.tag) ? 4 : 3, click: click(open, m.url) };
}

const RECEIPT: Record<ReceiptStatus, string> = { verified: "verified", partly: "partly done", unverified: "not verified", failed: "check failed" };
/** A top-level agent task reached a resting state. Its title is never sent; the receipt status is (read-back checks, receipt-pure). */
export function taskMsg(status: string, receipt: ReceiptStatus | null, open: string, token?: string): NtfyMsg | null {
  if (status === "done") return { kind: "done", title: `Task finished${receipt ? ` · ${RECEIPT[receipt]}` : ""}`, message: "Open ORBIT to see the result and its receipt.", tags: [receipt === "verified" ? "white_check_mark" : "ballot_box_with_check"], priority: 3, click: click(open, "/remote#r-queue") };
  if (status === "failed") return { kind: "failed", title: "A task failed", message: "Open ORBIT to see why and retry.", tags: ["warning"], priority: 4, click: click(open, "/remote#r-queue") };
  if (status === "awaiting_approval") return { kind: "decide", title: "A task needs your decision", message: "Something waits for your approval. Nothing goes out without your click.", tags: ["raised_hand"], priority: 3, click: click(open, "/remote#r-appr"),
    ...(token && open ? { acts: (["approve", "reject"] as const).map((a) => ({ label: a === "approve" ? "Approve" : "Reject", url: `${open}/api/remote/ntfy-act`, body: JSON.stringify({ token, action: a }) })) } : {}) };
  return null;
}

/** ntfy JSON publish (POST to the server root): unicode-safe, unlike header publishing. */
export function publishBody(c: NtfyConfig, m: NtfyMsg) {
  const http = (m.acts ?? []).slice(0, 2).map((a) => ({ action: "http", label: a.label, url: a.url, method: "POST", headers: { "Content-Type": "application/json" }, body: a.body, clear: true }));
  const actions = [...(m.click ? [{ action: "view", label: "Open", url: m.click }] : []), ...http];
  return { topic: c.topic, title: m.title.slice(0, 120), message: m.message.slice(0, 300), tags: m.tags, priority: m.priority, ...(m.click ? { click: m.click } : {}), ...(actions.length ? { actions } : {}) };
}
