import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { YT_SCOPES, hasScopes } from "./yt-analytics-pure";

// STUDIO analytics: Google OAuth for the owner's channel. The refresh token lives only in a file outside the repo (0600 on Unix; on Windows the
// %LOCALAPPDATA% ACL, i.e. this user + admins, protects it)
// (never in Supabase, so never in backups/exports); access tokens live only in memory. Nothing here logs or returns a token.

export type Stored = { refresh_token: string; scope: string; channelId: string; channelTitle: string; connectedAt: string };

/** Message is always a short code of ours or Google's `error` field: never its description, a token or a URL. */
export class OAuthError extends Error {}

export function oauthEnv() {
  const id = process.env.YOUTUBE_OAUTH_CLIENT_ID?.trim(), secret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

const tokenFile = () => {
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "orbit") : path.join(os.homedir(), ".orbit");
  return path.join(process.env.ORBIT_DATA_DIR?.trim() || local, "youtube-oauth.json");
};

const g = globalThis as unknown as { __orbitYt?: { access?: { token: string; exp: number; rt: string }; refreshing?: Promise<string>; expired?: boolean } };
const mem = (g.__orbitYt ??= {});

export async function readStored(): Promise<Stored | null> {
  try {
    const s = JSON.parse(await readFile(tokenFile(), "utf8"));
    return typeof s?.refresh_token === "string" && s.refresh_token ? s : null;
  } catch { return null; }
}

async function saveStored(s: Stored) {
  const f = tokenFile();
  await mkdir(path.dirname(f), { recursive: true, mode: 0o700 });
  await writeFile(f + ".tmp", JSON.stringify(s), { mode: 0o600 });
  await rename(f + ".tmp", f);
  mem.expired = false;
}

async function clearStored(expired: boolean) {
  await rm(tokenFile(), { force: true });
  mem.access = undefined;
  mem.expired = expired;
}

/** The last refresh failed with invalid_grant (Google "Testing" apps expire refresh tokens after 7 days). */
export const wasExpired = () => !!mem.expired;

export async function post(url: string, params: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params),
    signal: AbortSignal.timeout(10_000), cache: "no-store",
  }).catch(() => { throw new OAuthError("network"); });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new OAuthError(typeof json?.error === "string" ? json.error.slice(0, 40) : `http_${res.status}`);
  return json as { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string };
}

const remember = (token: string, expiresIn: number | undefined, rt: string) => {
  mem.access = { token, exp: Date.now() + (expiresIn ?? 3600) * 1000, rt };
};

/** A valid access token (refreshed when < 60 s left; concurrent callers share one refresh). Throws OAuthError("invalid_grant") once the grant is dead. */
export async function getAccessToken(s: Stored): Promise<string> {
  const a = mem.access;
  if (a && a.rt === s.refresh_token && a.exp - Date.now() > 60_000) return a.token;
  const cfg = oauthEnv();
  if (!cfg) throw new OAuthError("not_configured");
  return (mem.refreshing ??= (async () => {
    try {
      const t = await post("https://oauth2.googleapis.com/token", { grant_type: "refresh_token", refresh_token: s.refresh_token, client_id: cfg.id, client_secret: cfg.secret });
      if (!t.access_token) throw new OAuthError("no_access_token");
      remember(t.access_token, t.expires_in, s.refresh_token);
      return t.access_token;
    } catch (e) {
      // Only forget the file if it still holds the grant that failed (a reconnect may have replaced it meanwhile).
      if (e instanceof OAuthError && e.message === "invalid_grant" && (await readStored())?.refresh_token === s.refresh_token) await clearStored(true);
      throw e;
    }
  })().finally(() => { mem.refreshing = undefined; }));
}

/** Drops the cached access token (after a 401) so the next call refreshes. */
export const invalidateAccess = () => { mem.access = undefined; };

/** Code → tokens → which channel → saved. Throws OAuthError with a short reason code safe for a URL. */
export async function connect(code: string, verifier: string, redirectUri: string) {
  const cfg = oauthEnv();
  if (!cfg) throw new OAuthError("not_configured");
  const t = await post("https://oauth2.googleapis.com/token", {
    grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri, client_id: cfg.id, client_secret: cfg.secret,
  }).catch(() => { throw new OAuthError("exchange"); });
  if (!t.access_token || !t.refresh_token) throw new OAuthError("no_refresh");
  const fail = async (reason: string) => { await revokeYt(t.refresh_token!); throw new OAuthError(reason); }; // don't leave an unused grant alive
  const scope = t.scope ?? "";
  // Only the read scopes are required (analytics); upload is optional and checked when publishing.
  if (!hasScopes(scope, YT_SCOPES)) await fail("scope"); // user unticked a box on the consent screen
  const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { authorization: `Bearer ${t.access_token}` }, signal: AbortSignal.timeout(10_000), cache: "no-store",
  }).catch(() => null);
  const ch = res?.ok ? ((await res.json().catch(() => null)) as { items?: { id: string; snippet?: { title?: string } }[] } | null)?.items?.[0] : undefined;
  if (!ch) return fail(res?.ok ? "no_channel" : "channel");
  const prev = await readStored();
  try {
    await saveStored({ refresh_token: t.refresh_token, scope, channelId: ch.id, channelTitle: ch.snippet?.title ?? "", connectedAt: new Date().toISOString() });
  } catch (e) { await revokeYt(t.refresh_token); throw e; } // couldn't keep it: don't leave it alive at Google
  if (prev && prev.refresh_token !== t.refresh_token) await revokeYt(prev.refresh_token); // reconnect replaces the old grant
  remember(t.access_token, t.expires_in, t.refresh_token);
}

export const revoke = (token: string) => post("https://oauth2.googleapis.com/revoke", { token }).catch(() => {});

/** LIFE calendar may share this Google client (no GCAL_OAUTH_CLIENT_ID): Google revokes per client + user, so revoking one grant
 *  would kill the other. True when `otherFile` (a grant of the other feature) exists in the data dir and the client is shared. */
export const sharedGrant = async (otherFile: string) =>
  !(process.env.GCAL_OAUTH_CLIENT_ID?.trim() && process.env.GCAL_OAUTH_CLIENT_SECRET?.trim()) &&
  (await readFile(path.join(path.dirname(tokenFile()), otherFile)).then(() => true, () => false));
/** Revoke a YouTube grant unless that would also kill the calendar grant (then only the local file is forgotten). */
const revokeYt = async (token: string) => { if (!(await sharedGrant("gcal-oauth.json"))) await revoke(token); };

/** Best-effort revoke at Google, then forget locally. */
export async function disconnect() {
  const s = await readStored();
  if (s) await revokeYt(s.refresh_token);
  await clearStored(false);
}
