// Runs scripts/migrations-dryrun.sh when a local Postgres with pgvector is installed; skips otherwise (CI runs it in
// .github/workflows/migrations.yml). Fresh apply in order must pass, re-runs must not change data, 0018+ must re-run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

const pgRoot = "/usr/lib/postgresql";
const pgBin = existsSync(pgRoot)
  ? readdirSync(pgRoot).sort((a, b) => Number(b) - Number(a)).map((v) => `${pgRoot}/${v}/bin`).find((b) => existsSync(`${b}/initdb`))
  : undefined;
let hasVector = false;
if (pgBin) {
  try {
    const share = execFileSync(`${pgBin}/pg_config`, ["--sharedir"], { encoding: "utf8" }).trim();
    hasVector = existsSync(`${share}/extension/vector.control`);
  } catch { hasVector = existsSync("/usr/share/postgresql/16/extension/vector.control"); }
}

test("supabase migrations apply in order and re-run without changing data", { skip: !pgBin || !hasVector ? "no local Postgres + pgvector" : false, timeout: 120_000 }, () => {
  const r = spawnSync("bash", ["scripts/migrations-dryrun.sh", "--strict-rerun-from", "0018"], { encoding: "utf8", env: { ...process.env, PGBIN: pgBin } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ok {4}0029_gpu_jobs\.sql/);
  assert.match(r.stdout, /Data unchanged after re-runs\./);
});
