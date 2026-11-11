import { cookies } from "next/headers";
import { signToken, verifyPair } from "@/lib/remote-pure";
import { cookieOptions, deviceName, pairClientKey, RATE, REMOTE_COOKIE, REMOTE_TOKEN_DAYS } from "@/lib/remote-web-pure";
import { newDeviceId, rateOk, remoteProblem, remoteSecret, S, updateDevices } from "@/lib/remote";
import { publicOrigin } from "@/lib/origin-pure";

export const dynamic = "force-dynamic";

// Phone: POST {code, name?, type?: "screen"} with the 6-digit code the PC shows → a device token in an HttpOnly cookie (see docs/PHONE.md).
// DELETE forgets the token on this phone (the PC's Revoke is what unpairs it for good).
export async function POST(req: Request) {
  const problem = remoteProblem();
  if (problem) return Response.json({ error: problem }, { status: 503 });
  // Global cap first, so a client rotating x-forwarded-for can't mint unlimited per-client keys; the per-client key is best effort (spoofable).
  const who = pairClientKey(req.headers);
  if (!rateOk("pair:all", RATE.pairAll) || !rateOk(who, RATE.pair)) return Response.json({ error: "Too many tries: wait a minute" }, { status: 429 });
  const b = (await req.json().catch(() => null)) as { code?: unknown; name?: unknown; type?: unknown } | null;
  const p = S.pair;
  if (!p) return Response.json({ error: "No pairing code: press Pair phone on the PC first" }, { status: 400 });
  const now = Date.now();
  const r = verifyPair(p, b?.code, now, who);
  const reserved = { ...r.pair, userId: p.userId };
  S.pair = reserved; // a right code is marked used at once, so two phones can't both pair with it
  if (!r.ok) return Response.json({ error: { expired: "That code expired: make a new one on the PC", locked: "Too many wrong codes: make a new one on the PC", used: "That code was already used: make a new one on the PC", wrong: "Wrong code" }[r.reason] }, { status: 401 });
  const device = { id: newDeviceId(), name: deviceName(b?.name), userId: p.userId, createdAt: new Date(now).toISOString(), ...(b?.type === "screen" && { type: "screen" as const }) }; // asking for a screen only ever narrows rights
  try { await updateDevices((ds) => [...ds, device]); }
  catch (e) { // devices file locked or damaged (safe-file.ts): nothing saved, so the code isn't spent
    if (S.pair === reserved) S.pair = p;
    return Response.json({ error: `Pairing didn't finish: ${e instanceof Error ? e.message : e}. The code still works: try again in a moment.` }, { status: 503 });
  }
  const token = signToken({ deviceId: device.id, issuedAt: now, exp: now + REMOTE_TOKEN_DAYS * 86_400_000 }, remoteSecret());
  const h = req.headers;
  const https = publicOrigin({ host: h.get("host"), forwardedHost: h.get("x-forwarded-host"), forwardedProto: h.get("x-forwarded-proto") }, req.url).startsWith("https:");
  (await cookies()).set(REMOTE_COOKIE, token, cookieOptions(https));
  return Response.json({ ok: true, name: device.name });
}

export async function DELETE() {
  (await cookies()).delete({ name: REMOTE_COOKIE, path: "/api/remote" });
  return Response.json({ ok: true });
}
