// Version-aware artifact context (roadmap 23; pure, tested in tests/artifact-rev.test.ts). A proposal, receipt or checkpoint line
// stores the exact revision it was based on; before applying, compare with the artifact now and refresh or explain, never apply silently.
// Revisions are opaque strings: files "sha256:<hex>@<mtimeMs>", ARCH saved versions "arch:<version id>", studio media "studio:<version id>".

export type Basis = { ref: string; rev: string };
export type Conflict = { ref: string; was: string; now: string | null };

export const fileRev = (sha256: string, mtimeMs: number) => `sha256:${sha256}@${Math.round(mtimeMs)}`;
export const archRev = (versionId: string) => `arch:${versionId}`;
export const studioRev = (versionId: string) => `studio:${versionId}`;

/** A file touched (mtime) but with the same bytes is not a change; everything else compares exactly. */
const same = (a: string, b: string) => (a.startsWith("sha256:") && b.startsWith("sha256:") ? a.split("@")[0] === b.split("@")[0] : a === b);

/** current: ref → revision now (null or missing = deleted or unreadable, which also counts as a conflict). */
export function staleBasis(basis: Basis[], current: Record<string, string | null | undefined>): Conflict[] {
  return basis.flatMap((b) => {
    const now = current[b.ref] ?? null;
    return now !== null && same(b.rev, now) ? [] : [{ ref: b.ref, was: b.rev, now }];
  });
}

/** The apply gate: ok, or the refs to refresh and a plain explanation for the owner. */
export function applyGuard(basis: Basis[], current: Record<string, string | null | undefined>): { ok: true } | { ok: false; refresh: string[]; explain: string } {
  const c = staleBasis(basis, current);
  if (!c.length) return { ok: true };
  const why = c.map((x) => x.now === null ? `${x.ref} is gone or unreadable (planned on ${x.was})` : `${x.ref} changed after planning (${x.was} → ${x.now})`);
  return { ok: false, refresh: c.map((x) => x.ref), explain: `Not applied: this was based on an older version. ${why.join("; ")}. Refresh the plan against the current version, or confirm it still fits.` };
}
