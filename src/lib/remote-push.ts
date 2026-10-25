// Phone push (roadmap 6.3), server glue: fire-and-forget pushNotify(kind) from the places that create approvals, publish Shorts,
// fail jobs or switch Stop-all on. Policy + crypto: remote-push-pure.ts. Subscriptions live on the paired device (remote.ts), so
// revoking the phone deletes its subscription. Never throws into the caller.
import { encryptPayload, flush, gate, pushLabel, vapidAuth, vapidProblem, type PushKind, type PushMessage, type Slot } from "./remote-push-pure";

const g = globalThis as unknown as { __orbitPush?: { slots: Map<PushKind, Slot>; timers: Set<PushKind> } };
const P = (g.__orbitPush ??= { slots: new Map(), timers: new Set() });

export const pushProblem = () => vapidProblem(process.env.REMOTE_VAPID_PUBLIC, process.env.REMOTE_VAPID_PRIVATE);
// The JWT's contact (Apple requires one): sent to the push service only.
const subject = () => {
  const first = (process.env.ORBIT_ALLOWED_EMAILS ?? "").split(",")[0].trim();
  return process.env.REMOTE_VAPID_SUBJECT || (first ? `mailto:${first}` : "mailto:orbit@example.com");
};

/** Tell the paired phone something happened (a fixed label only; see pushLabel). Rate-limited and coalesced per kind. */
export function pushNotify(kind: PushKind): void {
  if (kind === "failed") void import("./call").then((c) => c.noteUrgent(), () => {}); // a failure may be worth a call (call-pure decides)
  if (pushProblem()) return;
  if (kind === "send" && !(process.env.RESEND_API_KEY && process.env.ORBIT_MAIL_FROM)) return; // the phone can't approve sends then
  const now = Date.now();
  const r = gate(P.slots.get(kind), kind, now);
  P.slots.set(kind, r.slot);
  if (r.send) void deliver(pushLabel(kind, r.send));
  else if (r.wakeAt && !P.timers.has(kind)) {
    P.timers.add(kind);
    setTimeout(() => {
      P.timers.delete(kind);
      const f = flush(P.slots.get(kind), kind, Date.now());
      P.slots.set(kind, f.slot);
      if (f.send) void deliver(pushLabel(kind, f.send));
    }, Math.max(0, r.wakeAt - now)).unref?.();
  }
}

/** Sends to every subscribed device (or just `deviceId`); a subscription the push service says is gone (404/410) is deleted. */
export async function deliver(msg: PushMessage, deviceId?: string): Promise<number> {
  try {
    const pub = process.env.REMOTE_VAPID_PUBLIC!, priv = process.env.REMOTE_VAPID_PRIVATE!;
    const { listDevices, updateDevices } = await import("./remote"); // lazy: remote.ts imports the clip factory, which calls us
    const targets = (await listDevices()).filter((d) => d.push && (!deviceId || d.id === deviceId));
    let ok = 0;
    for (const d of targets) {
      const sub = d.push!;
      const res = await fetch(sub.endpoint, {
        method: "POST", signal: AbortSignal.timeout(15_000),
        headers: { Authorization: vapidAuth(sub.endpoint, pub, priv, subject(), Date.now()), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
          TTL: String(msg.tag === "failed" ? 86_400 : msg.tag === "call" ? 1800 : 4 * 3600), Urgency: msg.tag === "failed" || msg.tag === "stop" || msg.tag === "call" ? "high" : "normal" },
        body: new Uint8Array(encryptPayload(Buffer.from(JSON.stringify(msg)), sub)),
      }).catch((e) => { console.error("[remote] push:", e instanceof Error ? e.message : e); return null; });
      if (res?.ok) ok++;
      else if (res?.status === 404 || res?.status === 410) await updateDevices((ds) => ds.map((x) => (x.id === d.id && x.push?.endpoint === sub.endpoint ? { ...x, push: undefined } : x)));
      else if (res) console.error("[remote] push refused:", res.status, (await res.text().catch(() => "")).slice(0, 200));
    }
    return ok;
  } catch (e) {
    console.error("[remote] push:", e instanceof Error ? e.message : e);
    return 0;
  }
}
