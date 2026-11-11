// A failed read of invoices.json is "not connected" (null) in the weekly outcome, never €0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { register } from "node:module";

// Resolver: extensionless relative imports get ".ts"; "@/x" is src/x (the Next alias).
const SRC = new URL("../src/", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, next) {
  if (s.startsWith("@/")) s = ${JSON.stringify(SRC)} + s.slice(2);
  try { return await next(s, c); } catch (e) { if ((s.startsWith(".") || s.startsWith("file:")) && !/\\.[a-z]+$/.test(s)) return next(s + ".ts", c); throw e; } }`));

const DIR = (process.env.ORBIT_DATA_DIR = await mkdtemp(path.join(tmpdir(), "orbit-weekio-")));
const { getWeek } = await import("../src/lib/outcome-week.ts");
const sb = { from: () => ({ select: () => ({ gte: async () => ({ data: [], error: null }) }) }) } as never;
const quiet = console.error; console.error = () => {};

test("an unreadable invoices.json shows not connected; a missing one is a real 0", async () => {
  await writeFile(path.join(DIR, "invoices.json"), "{ not json");
  assert.equal((await getWeek(sb)).revenueCents.value, null);
  await writeFile(path.join(DIR, "invoices.json"), JSON.stringify({ seller: null, invoices: [] }));
  assert.equal((await getWeek(sb)).revenueCents.value, 0);
  console.error = quiet;
});
