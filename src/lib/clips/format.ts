// Pure display helpers for the Clip Factory UI (no React, no Node APIs) so they can be unit-tested.
export { mmss } from "../chart-pure.ts";

const UNITS = ["B", "KB", "MB", "GB", "TB"];
/** 1536 → "1.5 KB", 0 → "0 B"; one decimal under 10 of a unit, none above. */
export function bytes(n: number): string {
  let v = Number.isFinite(n) && n > 0 ? n : 0, u = 0;
  while (v >= 1024 && u < UNITS.length - 1) { v /= 1024; u++; }
  return `${u && v < 10 ? v.toFixed(1) : Math.round(v)} ${UNITS[u]}`;
}

const ACTIVE = new Set(["queued", "probing", "transcribing", "finding", "rendering"]);
/** True while the server is still working on the job or any of its clips (the UI polls while this holds). */
export function isJobActive(job: { status: string; clips?: { status: string }[] }): boolean {
  return ACTIVE.has(job.status) || !!job.clips?.some((c) => c.status === "rendering");
}

// Link validation lives here (not pure.ts, which imports node:path) so the UI can use the exact same rules as the server.
const LINK_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be",
  "twitch.tv", "www.twitch.tv", "m.twitch.tv", "clips.twitch.tv", "kick.com", "www.kick.com"]);
/** A YouTube/Twitch/Kick link → its normalised https href, else null. Forgiving about how it was pasted (spaces, no scheme, http,
 *  a whole <iframe> embed code); strict about the result: exact host match, no userinfo, port, whitespace, backslashes or control chars. */
export function parseClipUrl(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 2000) return null;
  let raw = (input.match(/src=["']([^"']+)["']/i)?.[1] ?? input).trim(); // pasted embed code → its src
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw.replace(/^\/\//, "")}`; // "youtube.com/watch?v=…"
  raw = raw.replace(/^http:\/\//i, "https://");
  if (raw.length > 300 || !/^https:\/\/[^\s\\\x00-\x1f\x7f]+$/i.test(raw)) return null;
  // Checked on the raw text too: the URL parser silently drops a default ":443" port.
  if (/[@:]/.test(raw.slice(8).split(/[/?#]/)[0])) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  u.hash = ""; // fragments mean nothing to YouTube/Twitch and yt-dlp reads "#__youtubedl_smuggle" ones
  return u.protocol === "https:" && LINK_HOSTS.has(u.hostname) && !u.username && !u.password && !u.port ? u.href : null;
}

/** A parseClipUrl link that is a channel page rather than one video: "youtube" for YouTube channels (they belong in the scout's creators). */
export function channelLink(href: string): "youtube" | "other" | null {
  let u: URL;
  try { u = new URL(href); } catch { return null; }
  const parts = u.pathname.split("/").filter(Boolean);
  if (u.hostname.endsWith("youtube.com")) {
    if (parts[0] === "playlist") return "other"; // a whole playlist, not one video
    return parts.length && !/^(watch|shorts|live|embed|v)$/.test(parts[0]) ? "youtube" : null; // /@x, /channel/…, /c/x, /user/x, /PewDiePie
  }
  if (u.searchParams.has("clip")) return null; // kick.com/name?clip=… is one clip
  if (u.hostname === "clips.twitch.tv" || u.hostname === "youtu.be") return null;
  return parts.length === 1 && parts[0] !== "videos" ? "other" : null; // twitch.tv/name, kick.com/name: a live channel, not a video
}
export const CHANNEL_LINK_MSG = { youtube: "That's a channel link. Add it under Video scout → Creators so ORBIT watches its new videos.", other: "That's a channel page, not a video: paste a link to one video." };

/** Optional note on how the creator allows clipping, as one line ("" when none); null only when invalid (> 300 chars or not a string). */
export function cleanPermission(s: unknown): string | null {
  if (s === undefined || s === null) return "";
  if (typeof s !== "string") return null;
  const t = s.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
  return t.length <= 300 ? t : null;
}

/** Quick reasons offered when rejecting a clip (stored as review feedback). */
export const REJECT_REASONS = ["boring", "no context", "bad cut", "bad captions", "too long", "other"] as const;
export const CAPTION_STYLES = ["karaoke", "classic", "none"] as const;
/** "clip-2-v3" → "clip-2": the original a version was made from. */
export const rootClipId = (id: string) => id.replace(/-v\d+$/, "");

export const LAYOUT_NAME = { fit: "Fit", fill: "Fill", follow: "Follow action", split: "Split" } as const;
export const CAM_NAME = { left: "Left third", right: "Right third", tl: "Top-left box", tr: "Top-right box", bl: "Bottom-left box", br: "Bottom-right box" } as const;
/** A job's layout for its summary line: "Follow action", "Split · Top-right box". Missing (jobs from before layouts) = Fit. */
export function layoutText(o: { layout?: string; camSide?: string }): string {
  const name = LAYOUT_NAME[(o.layout ?? "fit") as keyof typeof LAYOUT_NAME] ?? o.layout ?? "Fit";
  return o.layout === "split" ? `${name} · ${CAM_NAME[(o.camSide ?? "right") as keyof typeof CAM_NAME] ?? o.camSide}` : name;
}
