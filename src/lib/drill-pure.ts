// Recovery drills (roadmap 45), pure half: does a restored backup actually hold usable data? IO: drill.ts. Tested in tests/drill.test.ts.
// A drill restores into a throwaway temp folder, never over the real data dir, then checks every file reads back byte-for-byte and parses.
import { createHash } from "node:crypto";
import { check, type Check } from "./doctor-pure.ts";
import type { PackedFile } from "./capsule-pure.ts";

export type DrillResult = { at: string; ok: boolean; backup?: string; backupAt?: string; expected?: number; restored?: number; parsed?: number; bad?: string[]; error?: string };
export const DRILL_FILE = "recovery-drill.json";
export const DRILL_STALE_DAYS = 35;

/** A store file parses: .json as one value, .jsonl line by line (blank lines allowed). Other files only have to read back. */
export function parses(p: string, data: Buffer): boolean {
  try {
    const t = data.toString("utf8");
    if (/\.json$/i.test(p)) JSON.parse(t);
    else if (/\.jsonl$/i.test(p)) for (const l of t.split(/\r?\n/)) if (l.trim()) JSON.parse(l);
    return true;
  } catch { return false; }
}

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Compares what the backup held with what was read back from the temp folder (null = file missing there). */
export function verifyRestore(expected: number, files: PackedFile[], readBack: Map<string, Buffer | null>): Omit<DrillResult, "at" | "backup" | "backupAt"> {
  const bad: string[] = [];
  let restored = 0, parsed = 0;
  for (const f of files) {
    const b = readBack.get(f.path);
    if (!b || sha(b) !== sha(f.data)) { bad.push(`${f.path} (not restored intact)`); continue; }
    restored++;
    if (parses(f.path, b)) parsed++; else bad.push(`${f.path} (doesn't parse)`);
  }
  if (files.length !== expected) bad.unshift(`backup says ${expected} files, holds ${files.length}`);
  return { ok: bad.length === 0 && restored > 0, expected, restored, parsed, bad: bad.slice(0, 20) };
}

/** Doctor row "Last drill". */
export function drillCheck(last: DrillResult | null, now: number): Check {
  const L = "Last recovery drill", fix = "Profile → Time capsule → Run restore drill (needs your passphrase; your data isn't touched).";
  if (!last) return check("drill", L, "warn", "Never run: a backup that was never restored isn't proven to work", fix);
  const days = Math.floor((now - Date.parse(last.at)) / 86_400_000), when = days < 1 ? "today" : `${days} day${days > 1 ? "s" : ""} ago`;
  if (!last.ok) return check("drill", L, "fail", `Failed ${when}: ${(last.error ?? last.bad?.join("; ") ?? "unknown").slice(0, 200)}`, fix);
  const txt = `Passed ${when}: ${last.restored}/${last.expected} files restored and ${last.parsed} parsed from ${last.backup}`;
  return days > DRILL_STALE_DAYS ? check("drill", L, "warn", txt, fix) : check("drill", L, "ok", txt);
}
