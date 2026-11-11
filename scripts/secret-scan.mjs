#!/usr/bin/env node
// S08: fail when a real-looking credential is committed. Scans git-tracked files (no network, runs first in `npm run gate`).
// Known key shapes always fail; a high-entropy value assigned to a key/token/secret name fails too. Allow a line with a trailing
// `secret-scan: allow` comment, or a path in ALLOW (test fixtures, lockfile, binaries). .env.example is scanned: it must stay empty.
// Usage: node scripts/secret-scan.mjs [dir]   Tests: tests/secret-scan.test.ts
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const RULES = [
  ["private key block", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ["Anthropic/OpenAI key", /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/],
  ["Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{16,}|\bsbp_[a-f0-9]{30,}/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{20,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Stripe live key", /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}/],
];
const NAMED = /\b[\w-]*(?:api[_-]?key|secret|token|passw(?:or)?d|private[_-]?key)[\w-]*["']?\s*[:=]\s*["']([A-Za-z0-9+/_=-]{24,})["']/i;
const ALLOW = [/^tests\/fixtures\//, /^package-lock\.json$/, /\.(?:png|jpe?g|gif|webp|ico|woff2?|ttf|mp3|mp4|wav|glb|gltf|bin|pdf|zip|hdr|exr)$/i];

/** Shannon entropy in bits per character: random keys sit above ~4, words and ids below. */
export const entropy = (s) => { const n = {}; for (const c of s) n[c] = (n[c] ?? 0) + 1; return Object.values(n).reduce((h, k) => h - (k / s.length) * Math.log2(k / s.length), 0); };

/** Findings for one file's text: [{ line, rule }]. Values are never printed, only where and what kind. */
export function scanText(text) {
  const out = [];
  text.split("\n").forEach((l, i) => {
    if (l.length > 4000 || /secret-scan:\s*allow/.test(l)) return;
    for (const [rule, re] of RULES) if (re.test(l)) { out.push({ line: i + 1, rule }); return; }
    const m = l.match(NAMED);
    if (m && entropy(m[1]) > 4 && !/^(?:x+|example|placeholder|your[_-]|changeme)/i.test(m[1])) out.push({ line: i + 1, rule: "high-entropy value in a secret-named field" });
  });
  return out;
}

function files(dir) {
  try { return execFileSync("git", ["ls-files", "-z"], { cwd: dir, encoding: "utf8" }).split("\0").filter(Boolean); }
  catch { // not a git checkout (tests): walk it
    const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return f === "node_modules" || f.startsWith(".git") ? [] : statSync(p).isDirectory() ? walk(p) : [relative(dir, p)]; });
    return walk(dir);
  }
}

export function scanDir(dir) {
  const hits = [];
  for (const f of files(dir)) {
    const rel = f.replace(/\\/g, "/");
    if (ALLOW.some((re) => re.test(rel))) continue;
    let text; try { text = readFileSync(join(dir, f), "utf8"); } catch { continue; }
    if (text.includes("\0")) continue; // binary
    for (const h of scanText(text)) hits.push({ file: rel, ...h });
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("secret-scan.mjs")) {
  const hits = scanDir(process.argv[2] ?? process.cwd());
  if (hits.length) {
    console.error(`secret-scan: ${hits.length} possible credential(s) committed:\n${hits.map((h) => `  ${h.file}:${h.line}  ${h.rule}`).join("\n")}\nRemove and rotate it, or mark a known-fake value with a trailing "secret-scan: allow" comment.`);
    process.exit(1);
  }
  console.log("secret-scan: clean");
}
