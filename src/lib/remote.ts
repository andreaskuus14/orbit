// iPhone remote (roadmap 6.2), server glue: paired devices, the live pair code, device auth, acting as the owner, approvals.
// Protocol: remote-pure.ts; decisions: remote-web-pure.ts; routes: /api/remote/*; owner setup: docs/PHONE.md.
import { randomBytes, randomInt } from "node:crypto";
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "@/lib/supabase/admin";
import { orbitDataDir } from "@/lib/data-dir";
import { emit } from "@/lib/claude";
import { makePairCode, NonceCache, verifyToken, type PairCode, type RemoteCommand } from "@/lib/remote-pure";
import { approvalId, clipStamp, ledgerData, quoteStamp, REMOTE_COOKIE, secretProblem, takeRate, type Approval } from "@/lib/remote-web-pure";
import { isAllowedEmail } from "@/lib/allow";
import { listJobs } from "@/lib/clips/factory";
import { listStories } from "@/lib/clips/story";
import { approveProblem, quoteTotal } from "@/lib/clips/story-pure";
import { emailIn } from "@/lib/business-pure";
import type { PushSub } from "@/lib/remote-push-pure";

export type Device = { id: string; name: string; userId: string; createdAt: string; push?: PushSub }; // push: its Web Push subscription (6.3)
type State = { pair?: PairCode & { userId: string }; nonces: NonceCache; hits: Map<string, number[]>; seen: Map<string, string>; chat: Map<string, { id: string; at: number }>;
  owner?: { userId: string; email: string; sb: SupabaseClient }; save?: Promise<unknown> };
const g = globalThis as unknown as { __orbitRemote?: State };
export const S: State = (g.__orbitRemote ??= { nonces: new NonceCache(), hits: new Map(), seen: new Map(), chat: new Map() });

export const remoteSecret = () => process.env.REMOTE_SECRET ?? "";
export const remoteProblem = () => secretProblem(process.env.REMOTE_SECRET);

// ---- Devices: <data dir>/remote-devices.json (tokens are HMAC-signed and never stored; push subscriptions are only usable with the VAPID key) ----
const file = () => path.join(orbitDataDir(), "remote-devices.json");
export async function listDevices(): Promise<Device[]> {
  try {
    const v = JSON.parse(await readFile(file(), "utf8"));
    return Array.isArray(v) ? v.filter((d) => d && typeof d.id === "string" && typeof d.userId === "string") : [];
  } catch { return []; }
}
/** Serialized read-modify-write, saved atomically (tmp + rename). */
export function updateDevices(fn: (ds: Device[]) => Device[]): Promise<Device[]> {
  const p = (S.save ?? Promise.resolve()).catch(() => {}).then(async () => {
    const next = fn(await listDevices());
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(next, null, 1));
    await rename(file() + ".tmp", file());
    return next;
  });
  S.save = p;
  return p;
}
export const newDeviceId = () => randomBytes(18).toString("base64url");
export const newPair = (userId: string) => (S.pair = { ...makePairCode(randomInt), userId });

export function rateOk(key: string, r: { limit: number; windowMs: number }) {
  const t = takeRate(S.hits.get(key) ?? [], Date.now(), r.limit, r.windowMs);
  S.hits.set(key, t.hits);
  return t.ok;
}

/** The paired device behind this request's cookie, or null (bad/expired token, or revoked device). */
export async function deviceFromCookie(): Promise<Device | null> {
  const token = (await cookies()).get(REMOTE_COOKIE)?.value;
  if (!token) return null;
  const v = verifyToken(token, remoteSecret(), Date.now());
  if (!v.ok) return null;
  const d = (await listDevices()).find((x) => x.id === v.payload.deviceId) ?? null;
  if (d) S.seen.set(d.id, new Date().toISOString());
  return d;
}

/** A Supabase client signed in as the owner (RLS applies, as on the PC). Minted server-side with the service key: a magic-link
 *  token is generated and redeemed here (no email is sent), so it is a separate session and never touches the PC's sign-in. */
export async function ownerClient(userId: string): Promise<SupabaseClient> {
  // The allowlist is re-checked on every use, so removing the owner from ORBIT_ALLOWED_EMAILS cuts the phone off too.
  if (S.owner?.userId === userId && isAllowedEmail(S.owner.email) && (await S.owner.sb.auth.getSession()).data.session) return S.owner.sb;
  S.owner = undefined;
  const admin = adminClient();
  if (!admin) throw new Error("Phone remote needs SUPABASE_SECRET_KEY in .env.local to act for you");
  const { data: u, error: ue } = await admin.auth.admin.getUserById(userId);
  if (ue || !u.user?.email) throw new Error("Paired owner account not found");
  if (!isAllowedEmail(u.user.email)) throw new Error("Paired account is not in ORBIT_ALLOWED_EMAILS");
  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  if (le || !link.properties?.hashed_token) throw new Error(`Couldn't sign in as you: ${le?.message ?? "no token"}`);
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }); // getSession() refreshes an expired session itself
  const { data: s, error: se } = await sb.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (se || s.user?.id !== userId) throw new Error(`Couldn't sign in as you: ${se?.message ?? "wrong user"}`);
  S.owner = { userId, email: u.user.email, sb };
  return sb;
}

/** One ledger event per remote command: type, outcome, device. Never message text. */
export const logCommand = (sb: SupabaseClient | null, userId: string, cmd: RemoteCommand | null, ok: boolean, device: string) =>
  sb ? emit(sb, userId, "remote.command", "core", ledgerData(cmd, ok, device)) : Promise.resolve();

const item = (key: string, a: Omit<Approval, "id" | "key">): Approval => ({ id: approvalId(key, remoteSecret()), key, ...a });

/** Clips waiting in review, with their thumbnail path (server-side only). Retry clips replace a published Short: that review stays on the PC. */
export async function clipApprovals(): Promise<(Approval & { thumbPath?: string })[]> {
  const jobs = await listJobs().catch(() => []);
  return jobs.flatMap((j) => j.clips.filter((c) => c.status === "ready" && !c.retryOf).map((c) => ({
    ...item(`clip:${j.id}/${c.id}`, { kind: "clip", title: c.title, detail: `Short from ${j.source}`, seen: clipStamp(c), thumb: !!c.thumb }), thumbPath: c.thumb,
  })));
}

/** Everything already waiting for the owner's click, as it is right now. */
export async function pendingApprovals(sb: SupabaseClient): Promise<Approval[]> {
  const [clips, stories, prospects] = await Promise.all([
    clipApprovals(),
    listStories().catch(() => []),
    process.env.RESEND_API_KEY && process.env.ORBIT_MAIL_FROM
      ? sb.from("prospects").select("id,name,contact,draft,stage,updated_at").eq("stage", "lead").not("draft", "is", null).limit(50).then((r) => r.data ?? [])
      : Promise.resolve([]),
  ]);
  const out: Approval[] = clips.map(({ thumbPath: _t, ...a }) => a);
  for (const s of stories) {
    const credits = quoteTotal(s.items);
    if (s.quote && !approveProblem(s, credits)) out.push(item(`spend:${s.id}`, { kind: "spend", title: s.story.title, detail: `${s.draft ? "Higgsfield draft" : "AI Story"}: Higgsfield spend${s.quote.balance !== null ? ` (balance ${s.quote.balance})` : ""}`, credits, seen: quoteStamp(s.quote) }));
  }
  for (const p of prospects as { id: string; name: string; contact: string | null; draft: string | null; updated_at: string }[]) {
    const to = emailIn(p.contact ?? "");
    if (to && p.draft?.trim()) out.push(item(`send:${p.id}`, { kind: "send", title: p.name, detail: "BUSINESS email", to, message: p.draft, seen: p.updated_at }));
  }
  return out;
}

/** Device id → the CORE chat the phone continues (a new one after 30 idle minutes). */
export function remoteChat(deviceId: string): string | undefined {
  const c = S.chat.get(deviceId);
  return c && Date.now() - c.at < 30 * 60_000 ? c.id : undefined;
}
