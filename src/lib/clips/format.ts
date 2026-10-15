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
const LINK_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "twitch.tv", "www.twitch.tv", "clips.twitch.tv"]);
/** A YouTube/Twitch https link → its normalised href, else null. Exact host match; no userinfo, port, whitespace, backslashes or control chars. */
export function parseClipUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 300 || !/^https:\/\/[^\s\\\x00-\x1f\x7f]+$/i.test(raw)) return null;
  // Checked on the raw text too: the URL parser silently drops a default ":443" port.
  if (/[@:]/.test(raw.slice(8).split(/[/?#]/)[0])) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  u.hash = ""; // fragments mean nothing to YouTube/Twitch and yt-dlp reads "#__youtubedl_smuggle" ones
  return u.protocol === "https:" && LINK_HOSTS.has(u.hostname) && !u.username && !u.password && !u.port ? u.href : null;
}

/** The owner's note on how the creator allows clipping: one line, 5–300 chars, else null. */
export function cleanPermission(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
  return t.length >= 5 && t.length <= 300 ? t : null;
}
