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
