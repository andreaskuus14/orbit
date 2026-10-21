import { getAccessToken, invalidateAccess, readStored } from "./yt-oauth";
import { hasScopes, isVideoId, YT_MANAGE_SCOPE } from "./yt-analytics-pure";
import { meterYoutube, withYoutubeBudget } from "./youtube-quota";
import { privacyStatus } from "./clips/flop-retry-pure";
import { stopAllOn } from "./stop-all";

type Video = { id: string; snippet?: { channelId?: string }; status?: Record<string, unknown> };

/** No delete endpoint. Callers must hold the job lock and establish the stored approval (or the owner's restore click). */
export async function changeRetryPrivacy(oldId: string, privacy: "private" | "public", replacementId?: string): Promise<boolean> {
  if (!isVideoId(oldId) || (replacementId !== undefined && (!isVideoId(replacementId) || replacementId === oldId))) throw new Error("Invalid retry video ids");
  const s = await readStored();
  if (!s || !hasScopes(s.scope, [YT_MANAGE_SCOPE])) throw new Error("Reconnect YouTube to allow retry privacy changes");
  return withYoutubeBudget("flop-retry-privacy", "manual", async () => {
    const request = async (url: string, init: RequestInit = {}) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (stopAllOn()) throw new Error("Stop-all is on");
        const token = await getAccessToken(s);
        meterYoutube(init.method === "PUT" ? "videos.update" : "videos");
        const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
        if (r.status === 401 && attempt === 0) { invalidateAccess(); continue; }
        if (!r.ok) throw new Error(`YouTube privacy request failed (${r.status})`); // never echo tokens or Google's free-text errors
        return r.json();
      }
      throw new Error("YouTube sign-in expired");
    };
    const ids = [oldId, ...(replacementId ? [replacementId] : [])];
    const result = await request(`https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=${ids.join(",")}`) as { items?: Video[] };
    const old = result.items?.find((v) => v.id === oldId), replacement = result.items?.find((v) => v.id === replacementId);
    if (!s.channelId || old?.snippet?.channelId !== s.channelId || !old.status) throw new Error("Original video is unavailable or belongs to another channel");
    if (privacy === "private" && (!replacementId || replacement?.snippet?.channelId !== s.channelId || replacement.status?.privacyStatus !== "public" || replacement.status.uploadStatus !== "processed")) return false;
    if (old.status.privacyStatus === privacy) return true; // safe reconciliation after an unknown response
    const updated = await request("https://www.googleapis.com/youtube/v3/videos?part=status", { method: "PUT", body: JSON.stringify({ id: oldId, status: privacyStatus(old.status, privacy) }) }) as Video;
    if (updated.id !== oldId || updated.status?.privacyStatus !== privacy) throw new Error("YouTube did not confirm the privacy change");
    return true;
  });
}
