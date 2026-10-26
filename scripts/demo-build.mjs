// npm run demo:build — static export of the public demo (/demo) into demo-dist/, then the leak test (which also scans it).
// Builds a staging copy whose src/app holds only the root layout and app/demo: no API route, middleware or private page
// exists in that build at all. Nothing is deployed; publishing demo-dist/ is the owner's decision.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, ".."), stage = join(root, ".next-demo-stage"), dist = join(root, "demo-dist");
const run = (args, cwd, env = {}) => {
  const r = spawnSync(process.execPath, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) { rmSync(stage, { recursive: true, force: true }); process.exit(r.status ?? 1); } // a stale copy of src/ would double tsc's work
};

rmSync(stage, { recursive: true, force: true });
rmSync(dist, { recursive: true, force: true });
mkdirSync(join(stage, "src", "app"), { recursive: true });
for (const f of ["package.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs", "public"]) cpSync(join(root, f), join(stage, f), { recursive: true });
for (const f of readdirSync(join(root, "src"))) if (!["app", "middleware.ts", "instrumentation.ts"].includes(f)) cpSync(join(root, "src", f), join(stage, "src", f), { recursive: true });
for (const f of ["layout.tsx", "globals.css", "observatory.css", "icon.png", "demo"]) cpSync(join(root, "src", "app", f), join(stage, "src", "app", f), { recursive: true });
symlinkSync(join(root, "node_modules"), join(stage, "node_modules"), "junction");

run([createRequire(import.meta.url).resolve("next/dist/bin/next"), "build"], stage, { ORBIT_DEMO_EXPORT: "1", NEXT_TELEMETRY_DISABLED: "1" });
if (!existsSync(join(stage, "out", "demo.html"))) { console.error("demo:build: out/demo.html missing"); rmSync(stage, { recursive: true, force: true }); process.exit(1); }
cpSync(join(stage, "out"), dist, { recursive: true });
rmSync(stage, { recursive: true, force: true });
run(["--test", "--experimental-strip-types", "tests/demo-leak.test.ts"], root);
console.log("demo:build: static demo in demo-dist/ (open demo.html through any static file server)");
