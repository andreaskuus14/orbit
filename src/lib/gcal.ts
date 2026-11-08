import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import { OAuthError, oauthEnv, post, revoke, sharedGrant } from "./yt-oauth";
import { hasScopes } from "./yt-analytics-pure";
import { CAL_SCOPE, CAL_TTL_MS, calRange, eventsUrl, expiredMarker, mapEvents, ttlCache, type CalEvent } from "./gcal-pure";

// LIFE calendar: Google Calendar READ-ONLY with its own grant and token file (gcal-oauth.json in the ORBIT data dir, 0600).
// Client: GCAL_OAUTH_CLIENT_ID/_SECRET, else STUDIO's YouTube client. While shared, a revoke would also kill the YouTube grant
// (Google revokes per client + user), so then we only forget the local file. Nothing logs or returns a token.

type Stored = { refresh_token: string; scope: string; connectedAt: string };
const tokenFile = () => path.join(orbitDataDir(), "gcal-oauth.json");
const g = globalThis as unknown as { __orbitCal?: { access?: { token: string; exp: number; rt: string }; refreshing?: Promise<string> } };
const mem = (g.__orbitCal ??= {});
const cache = ttlCache<CalEvent[]>(CAL_TTL_MS);

export function calEnv() {
  const id = process.env.GCAL_OAUTH_CLIENT_ID?.trim(), secret = process.env.GCAL_OAUTH_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : oauthEnv();
}
const revokeCal = async (token: string) => { if (!(await sharedGrant("youtube-oauth.json"))) await revoke(token); };

export async function readCal(): Promise<Stored | null> {
  try {
    const s = JSON.parse(await readFile(tokenFile(), "utf8"));
    return typeof s?.refresh_token === "string" && s.refresh_token ? s : null;
  } catch { return null; }
}

/** expired: Google refused the grant. The token goes, but a { expiredAt } marker stays so the brief, LIFE and System health say
 *  "expired, reconnect" instead of a neutral "not connected" (it survives a restart; a new connect or Disconnect replaces it). */
async function clear(expired = false) {
  if (expired) await writeFile(tokenFile(), JSON.stringify({ expiredAt: new Date().toISOString() }), { mode: 0o600 });
  else await rm(tokenFile(), { force: true });
  mem.access = undefined; cache.clear();
}

/** True after Google refused the saved grant and he hasn't reconnected or disconnected since. */
export const calExpired = async () => expiredMarker(await readFile(tokenFile(), "utf8").catch(() => null));

/** A valid access token; concurrent callers share one refresh. */
async function accessToken(s: Stored): Promise<string> {
  const a = mem.access;
  if (a && a.rt === s.refresh_token && a.exp - Date.now() > 60_000) return a.token;
  const cfg = calEnv();
  if (!cfg) throw new OAuthError("not_configured");
  return (mem.refreshing ??= (async () => {
    try {
      const t = await post("https://oauth2.googleapis.com/token", { grant_type: "refresh_token", refresh_token: s.refresh_token, client_id: cfg.id, client_secret: cfg.secret });
      if (!t.access_token) throw new OAuthError("no_access_token");
      mem.access = { token: t.access_token, exp: Date.now() + (t.expires_in ?? 3600) * 1000, rt: s.refresh_token };
      return t.access_token;
    } catch (e) {
      if (e instanceof OAuthError && e.message === "invalid_grant" && (await readCal())?.refresh_token === s.refresh_token) await clear(true);
      throw e;
    }
  })().finally(() => { mem.refreshing = undefined; }));
}

/** Code → refresh token (must include calendar.readonly) → saved. */
export async function connectCal(code: string, verifier: string, redirectUri: string) {
  const cfg = calEnv();
  if (!cfg) throw new OAuthError("not_configured");
  const t = await post("https://oauth2.googleapis.com/token", {
    grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri, client_id: cfg.id, client_secret: cfg.secret,
  }).catch(() => { throw new OAuthError("exchange"); });
  if (!t.access_token || !t.refresh_token) throw new OAuthError("no_refresh");
  if (!hasScopes(t.scope, [CAL_SCOPE])) { await revokeCal(t.refresh_token); throw new OAuthError("scope"); } // user unticked the box
  const extra = (t.scope ?? "").split(" ").filter((x) => x && x !== CAL_SCOPE);
  if (extra.length) console.warn(`[gcal] grant also carries other scopes (shared Google client): ${extra.join(" ")}; ORBIT only uses calendar.readonly`);
  const prev = await readCal();
  const f = tokenFile();
  try {
    await mkdir(path.dirname(f), { recursive: true, mode: 0o700 });
    await writeFile(f + ".tmp", JSON.stringify({ refresh_token: t.refresh_token, scope: t.scope ?? "", connectedAt: new Date().toISOString() }), { mode: 0o600 });
    await rename(f + ".tmp", f);
  } catch (e) { await revokeCal(t.refresh_token); throw e; }
  if (prev && prev.refresh_token !== t.refresh_token) await revokeCal(prev.refresh_token);
  mem.access = { token: t.access_token, exp: Date.now() + (t.expires_in ?? 3600) * 1000, rt: t.refresh_token };
  cache.clear();
}

export async function disconnectCal() {
  const s = await readCal();
  if (s) await revokeCal(s.refresh_token);
  await clear();
}

/** Today + next `days` days from the primary calendar, cached 5 min. null = not connected. Throws on API/network errors. */
export async function calendarEvents(days: number, now = Date.now()): Promise<CalEvent[] | null> {
  const s = await readCal();
  if (!s) return null;
  // shortcut: primary calendar only; add a calendarId list here if other calendars are wanted.
  return cache.get(`${days}:${new Date(now).toDateString()}`, async () => {
    const { timeMin, timeMax } = calRange(now, days);
    const get = async () => fetch(eventsUrl(timeMin, timeMax), { headers: { authorization: `Bearer ${await accessToken(s)}` }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
    let res = await get();
    if (res.status === 401) { mem.access = undefined; res = await get(); }
    if (!res.ok) throw new Error(res.status === 403 ? "Google Calendar API refused (is it enabled in your Google Cloud project?)" : `Google Calendar error ${res.status}`);
    return mapEvents(await res.json());
  }, now);
}
