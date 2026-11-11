#!/usr/bin/env node
// S08 dependency update lane. Never runs in the gate (it needs the network) and never merges.
//   node scripts/deps-update.mjs            list outdated packages (current → wanted within the semver range → latest)
//   node scripts/deps-update.mjs --branch   on a fresh deps/update-<date> branch: install the "wanted" versions (lockfile pinned),
//                                           run the full gate, commit only if it passes. The owner reviews and merges the PR.
// Versions past the allowed range (majors, exact pins) are listed, never applied: each gets its own reviewed change.
import { execFileSync, spawnSync } from "node:child_process";

const sh = (cmd, args, opt = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], shell: process.platform === "win32", ...opt });
let out = "{}";
try { out = sh("npm", ["outdated", "--json"]); } catch (e) { out = e.stdout || "{}"; } // npm outdated exits 1 when anything is outdated
const rows = Object.entries(JSON.parse(out || "{}")).map(([name, v]) => ({ name, current: v.current, wanted: v.wanted, latest: v.latest, major: v.wanted !== v.latest }));
if (!rows.length) { console.log("All dependencies are up to date."); process.exit(0); }
console.log(rows.map((r) => `${r.name.padEnd(32)} ${String(r.current).padEnd(12)} → ${String(r.wanted).padEnd(12)} latest ${r.latest}${r.major ? "  (outside the allowed range: separate review)" : ""}`).join("\n"));
if (!process.argv.includes("--branch")) process.exit(0);

if (sh("git", ["status", "--porcelain"]).trim()) { console.error("Working tree not clean: commit or stash first."); process.exit(1); }
const minor = rows.filter((r) => r.current !== r.wanted);
if (!minor.length) { console.log("Nothing inside the allowed ranges to update; the rest need their own reviewed change."); process.exit(0); }
const branch = `deps/update-${new Date().toISOString().slice(0, 10)}`;
sh("git", ["switch", "-c", branch]);
sh("npm", ["install", "--save-exact=false", ...minor.map((r) => `${r.name}@${r.wanted}`)], { stdio: "inherit" });
if (spawnSync("npm", ["run", "gate"], { stdio: "inherit", shell: process.platform === "win32" }).status !== 0) {
  console.error(`Gate failed on ${branch}: nothing committed. Inspect, then 'git switch -' and delete the branch.`); process.exit(1);
}
sh("git", ["commit", "-am", `Dependencies: ${minor.map((r) => `${r.name} ${r.current}→${r.wanted}`).join(", ")}`]);
console.log(`Committed on ${branch}. Push it and open a PR for review; nothing was merged.`);
