// Lets plain `node --experimental-strip-types` load ORBIT's src/lib/*.ts (extensionless relative imports, "@/" alias).
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../src");
export async function resolve(spec, ctx, next) {
  let base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") && ctx.parentURL ? path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec) : null;
  if (base) for (const c of [base, base + ".ts", path.join(base, "index.ts")]) if (/\.ts$/.test(c) && existsSync(c)) return { url: pathToFileURL(c).href, shortCircuit: true };
  return next(spec, ctx);
}
