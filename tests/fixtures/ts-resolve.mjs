// Test-only resolve hook: lets a child Node process import server modules that use "@/..." and extensionless relative imports
// (as Next's bundler allows). Used by tests/global-collisions.test.ts to load real modules in a chosen order.
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`
import { existsSync } from "node:fs"; import { fileURLToPath, pathToFileURL } from "node:url"; import path from "node:path";
const root = ${JSON.stringify(process.cwd())};
export async function resolve(s, c, next) {
  if (s.startsWith("@/")) s = pathToFileURL(path.join(root, "src", s.slice(2))).href;
  if ((s.startsWith(".") || s.startsWith("file:")) && !/\\.[cm]?[jt]sx?$/.test(s)) {
    const base = new URL(s, c.parentURL);
    for (const ext of [".ts", ".tsx", "/index.ts"]) { const u = new URL(base.href + ext); if (existsSync(fileURLToPath(u))) return next(u.href, c); }
  }
  try { return await next(s, c); }
  catch (e) { if (e?.code === "ERR_MODULE_NOT_FOUND" && /^[@a-z][^:]*\\/[^.]+$/.test(s)) return next(s + ".js", c); throw e; } // "next/headers" → next/headers.js
}`));
