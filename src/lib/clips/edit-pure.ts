// STU05 editing workspace helpers (pure, client safe: type imports only; tested in tests/studio-depth.test.ts).
import type { ClipJob, VersionEdit } from "./types.ts";
import type { Revision } from "./production-pure.ts";

export const EDIT_KEYS = ["layout", "camSide", "camSize", "captions", "jumpCuts", "zooms", "coldOpen", "progressBar", "loopEnd"] as const;
export type Change = { key: (typeof EDIT_KEYS)[number]; from: unknown; to: unknown };

/** The settings that differ between two renders (missing = the job's base setting). */
export function editChanges(base: VersionEdit, a: Partial<VersionEdit> | undefined, b: Partial<VersionEdit> | undefined): Change[] {
  const A = { ...base, ...a }, B = { ...base, ...b };
  return EDIT_KEYS.filter((k) => A[k] !== B[k]).map((k) => ({ key: k, from: A[k], to: B[k] }));
}

const versionNo = (id: string) => Number(/-v(\d+)$/.exec(id)?.[1] ?? 1);
/** Parameter history of one moment: every render in version order with what changed against the one before it. */
export function paramHistory(revs: Revision[], base: VersionEdit): (Revision & { n: number; changes: Change[] })[] {
  const sorted = [...revs].sort((x, y) => versionNo(x.clip) - versionNo(y.clip));
  return sorted.map((r, i) => ({ ...r, n: versionNo(r.clip), changes: i ? editChanges(base, sorted[i - 1].edit, r.edit) : [] }));
}

/** Low-cost preview of a trim on the render that already exists (a media fragment: no ffmpeg). Lengthening needs frames the
 *  render doesn't have, so `beyond` says only the full render can show that part. */
export function trimPreview(lenSec: number, dStart: number, dEnd: number): { from: number; to: number; fragment: string; beyond: boolean } {
  const from = Math.max(0, Math.min(lenSec, dStart)), to = Math.max(from, Math.min(lenSec, lenSec + dEnd));
  return { from, to, fragment: `#t=${from.toFixed(1)},${to.toFixed(1)}`, beyond: dStart < 0 || dEnd > 0 };
}

/** Seconds one full render took on this job (its measured render stage / its first-pass clips), or null when never measured. */
export function renderEstimate(job: Pick<ClipJob, "timings" | "clips">): number | null {
  const n = job.clips.filter((c) => !c.variantOf).length, sec = job.timings?.render;
  return sec && n ? Math.round(sec / n) : null;
}
