import { check, type Check } from "./doctor-pure.ts";

// Running version, git refs and schema state for the doctor (roadmap 01). Pure: doctor.ts gathers the facts.

/** One cheap read-only probe per migration: a table (and column) it adds. Missing = no probe possible without writing (policies, functions, constraints). */
export const MIGRATION_MARKERS: Record<string, { table: string; column?: string }> = {
  "0001": { table: "usage" }, "0002": { table: "job_runs" }, "0003": { table: "tasks" }, "0004": { table: "tasks", column: "automation_id" },
  "0005": { table: "game_saves" }, "0006": { table: "proposals" }, "0007": { table: "core_playbook" }, "0008": { table: "memory_facts" },
  "0010": { table: "goals" }, "0011": { table: "prospects" }, "0012": { table: "memory_facts", column: "superseded_at" },
  "0013": { table: "messages", column: "attachment_text" }, "0015": { table: "prospects", column: "template" },
  "0016": { table: "events", column: "caused_by" }, "0019": { table: "memory_facts", column: "recheck_at" },
  "0020": { table: "missions" }, "0021": { table: "tasks", column: "claimed_by" },
};

/** Experimental switches worth seeing at a glance; only names and short values, never secrets. */
export const EXPERIMENTAL_ENV = ["ORBIT_CORE_ENGINE", "ORBIT_CORE_SESSION", "ORBIT_CORE_MAX_STEPS", "ORBIT_HIGGSFIELD_DRY_RUN", "ORBIT_REA_ENABLED", "ORBIT_LOCAL_MODEL"];

export type Refs = { running: string; builtAt: string; head: string | null; main: string | null; dirty: boolean | null };
const short = (s: string | null) => (s && s !== "unknown" ? s.slice(0, 7) : "unknown");

export function versionCheck(r: Refs, env: Record<string, string | undefined>): Check {
  const L = "Running version";
  const flags = EXPERIMENTAL_ENV.filter((k) => (env[k] ?? "").trim()).map((k) => `${k}=${String(env[k]).trim().slice(0, 30)}`);
  const parts = [`Running ${short(r.running)} (built ${r.builtAt})`, `checked out ${short(r.head)}${r.dirty ? " with uncommitted changes" : ""}`,
    `origin/main ${short(r.main)} (as of the last fetch)`, flags.length ? `experimental: ${flags.join(", ")}` : "no experimental settings"];
  const detail = parts.join("; ");
  if (r.running === "unknown") return check("version", L, "warn", `${detail}. This build has no commit stamp.`, "Rebuild ORBIT (npm run app:rebuild) so the commit is recorded.");
  if (r.head && r.head !== r.running) return check("version", L, "warn", `${detail}. The checked-out code differs from what is running.`, "Rebuild and restart ORBIT (npm run app:rebuild) to run the checked-out code.");
  return check("version", L, "ok", detail);
}

/** files: migration filenames on disk; applied: prefix → true/false from probes (absent = could not be probed). */
export function migrationCheck(files: string[], applied: Record<string, boolean>): Check {
  const L = "Database migrations";
  const ids = files.filter((f) => /^\d{4}_.*\.sql$/.test(f)).map((f) => f.slice(0, 4)).sort();
  const missing = ids.filter((id) => applied[id] === false);
  const unchecked = ids.filter((id) => !(id in applied));
  const ok = ids.length - missing.length - unchecked.length;
  const tail = unchecked.length ? `; ${unchecked.join(", ")} can't be checked without writing` : "";
  if (missing.length) return check("migrations", L, "fail", `${missing.length} of ${ids.length} migrations not applied: ${missing.join(", ")}${tail}`,
    "Run the missing files from supabase/migrations in the Supabase SQL editor, oldest first.");
  return check("migrations", L, "ok", `${ok} of ${ids.length} confirmed applied${tail}`);
}
