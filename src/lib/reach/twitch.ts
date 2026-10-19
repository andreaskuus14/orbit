import { TWITCH, parseTwitchClips, parseTwitchUsers, type ReachItem } from "./pure";
import { Blocked, UA, hintFor, polite } from "./net";

// Official Helix with the user's own free app key (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET in .env.local). App access token only:
// no user login. Plain fetch to fixed Twitch hosts (safeFetch can't send the auth headers); the secret never leaves this module.
export const TWITCH_HINT = "Add a free Twitch app key to see top clips (TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET from dev.twitch.tv/console)";
const env = () => { const id = process.env.TWITCH_CLIENT_ID?.trim(), secret = process.env.TWITCH_CLIENT_SECRET?.trim(); return id && secret ? { id, secret } : null; };
const g = globalThis as unknown as { __orbitTwitchTok?: { token: string; until: number } };

async function token(id: string, secret: string, fresh = false): Promise<string> {
  const c = g.__orbitTwitchTok;
  if (!fresh && c && Date.now() < c.until) return c.token;
  const res = await polite(TWITCH.token, () => fetch(TWITCH.token, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials" }), signal: AbortSignal.timeout(10_000), cache: "no-store",
  }));
  const j = (await res.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown };
  if (!res.ok || typeof j.access_token !== "string") throw new Blocked(res.status === 400 || res.status === 403 ? "Twitch rejected the app key; check TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET" : `token request answered ${res.status}`, res.status);
  g.__orbitTwitchTok = { token: j.access_token, until: Date.now() + Math.max(60, Number(j.expires_in) || 3600) * 1000 - 120_000 }; // renew 2 min early
  return j.access_token;
}

async function helix(url: string, id: string, secret: string): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const tok = await token(id, secret, attempt > 0);
    const res = await polite(url, () => fetch(url, { headers: { "Client-Id": id, Authorization: `Bearer ${tok}`, "User-Agent": UA }, signal: AbortSignal.timeout(10_000), cache: "no-store" }));
    if (res.status === 401 && attempt === 0) continue; // token revoked early: one fresh token
    if (!res.ok) throw new Blocked(`answered ${res.status}`, res.status);
    return res.json();
  }
  throw new Blocked("answered 401", 401);
}

/** Top clips of the last 24 h for each login (Helix sorts by views). Without a key: no requests, just the hint. */
export async function readTwitch(logins: string[], now = Date.now()): Promise<{ items: ReachItem[]; hints: string[] }> {
  const k = env();
  if (!k) return { items: [], hints: logins.length ? [TWITCH_HINT] : [] };
  if (!logins.length) return { items: [], hints: [] };
  const items: ReachItem[] = [], hints: string[] = [];
  try {
    const ids = parseTwitchUsers(await helix(TWITCH.users(logins.map((l) => l.toLowerCase())), k.id, k.secret));
    for (const l of logins) if (!ids.has(l.toLowerCase())) hints.push(`Twitch: no channel named ${l}`);
    for (const [, bid] of ids) items.push(...parseTwitchClips(await helix(TWITCH.clips(bid, new Date(now - 86_400_000)), k.id, k.secret)));
  } catch (e) { hints.push(hintFor("Twitch", e)); }
  return { items, hints };
}
