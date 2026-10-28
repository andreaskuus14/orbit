// Current artifact revisions for the apply guard (artifact-rev-pure.ts). Resolves workspace files ("file:<slug>/<path>" → sha256 of
// the bytes now) and the ARCH model ("arch:model" → its newest saved version). Other refs (studio media, missions) are not checked here.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir.ts";
import { readSnapshots } from "./arch-time-pure.ts";
import { applyGuard, archRev, fileRev, type Basis } from "./artifact-rev-pure.ts";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const checkable = (ref: string) => /^file:[^/]+\/.+/.test(ref) || ref === "arch:model";

async function currentRev(userId: string, ref: string): Promise<string | null> {
  if (ref === "arch:model") {
    try {
      const v = readSnapshots(JSON.parse(await readFile(path.join(orbitDataDir(), "arch-versions.json"), "utf8"))?.users?.[userId]);
      return v.length ? archRev(v[v.length - 1].at) : null;
    } catch { return null; }
  }
  const [, slug, rel] = ref.match(/^file:([^/]+)\/(.+)$/)!;
  const f = await (await import("./workspace.ts")).readWsFile(userId, slug, rel);
  return f ? fileRev(sha256(f.text), 0) : null; // the guard compares the hash only
}

/** The apply gate against the artifacts as they are now; refs this can't resolve are left to the caller. */
export async function guardNow(userId: string, basis: Basis[]) {
  const b = basis.filter((x) => checkable(x.ref));
  const now = Object.fromEntries(await Promise.all(b.map(async (x) => [x.ref, await currentRev(userId, x.ref)] as const)));
  return applyGuard(b, now);
}
