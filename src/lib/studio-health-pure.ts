// STUDIO channel health: three plain numbers with a light each, and the one thing to do next (the worst light).
// Pure; tested in tests/studio-health.test.ts. ORBIT's own rules of thumb, not YouTube benchmarks.
export type Light = "green" | "yellow" | "red" | "grey";
export type HealthItem = { id: "posted" | "shown" | "kept"; label: string; value: string; goal: string; light: Light };
export type Health = { items: HealthItem[]; next: string };

export const POST_GOAL = 7; // 1 Short a day
const DAY = 86_400_000;
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Shorts that went live in the last 7 days (uploaded, or scheduled for a time that has passed). */
export function postedThisWeek(clips: { publish?: { status?: string; at?: string; scheduledFor?: string } }[], now: number): number {
  return clips.filter((c) => {
    const p = c.publish, t = Date.parse(p?.scheduledFor ?? (p?.status === "done" ? p.at ?? "" : ""));
    return (p?.status === "done" || p?.status === "scheduled") && t <= now && t > now - 7 * DAY;
  }).length;
}

const light = (v: number, green: number, yellow: number): Light => (v >= green ? "green" : v >= yellow ? "yellow" : "red");

export function channelHealth(x: { posted: number | null; views: number; shortsViews: number; engaged?: number; avgViewSec: number }): Health {
  const few = x.views < 10; // with almost no views a share means nothing
  const kept = x.engaged !== undefined ? x.engaged / Math.max(1, x.views) : null;
  const items: HealthItem[] = [
    { id: "posted", label: "Posted this week", value: x.posted === null ? "?" : `${x.posted} / ${POST_GOAL}`, goal: "1 Short a day",
      light: x.posted === null ? "grey" : light(x.posted, POST_GOAL, 3) },
    { id: "shown", label: "Shown by YouTube", value: few ? "too few views" : pct(x.shortsViews / x.views), goal: "50% of views from the Shorts feed",
      light: few ? "grey" : light(x.shortsViews / x.views, 0.5, 0.2) },
    kept !== null
      ? { id: "kept", label: "Kept watching", value: few ? "too few views" : pct(kept), goal: "half of viewers keep watching", light: few ? "grey" : light(kept, 0.5, 0.3) }
      : { id: "kept", label: "Kept watching", value: few ? "too few views" : `${Math.round(x.avgViewSec)} s on average`, goal: "30 s on average", light: few ? "grey" : light(x.avgViewSec, 30, 15) },
  ];
  const order: Light[] = ["red", "yellow"];
  const worst = order.map((l) => items.find((i) => i.light === l)).find(Boolean);
  const NEXT: Record<HealthItem["id"], string> = {
    posted: "Post 1 Short today, and keep to 1 a day this week: each Short is a new chance for YouTube to show you.",
    shown: "Make your next Short your own: add your comment or text on top, so YouTube shows it to more people.",
    kept: "Start your next Short on the best moment in the first 2 seconds, and cut the slow start.",
  };
  const next = worst ? NEXT[worst.id] : items.every((i) => i.light === "grey") ? NEXT.posted : "Looking good: keep the same rhythm and style.";
  return { items, next };
}
