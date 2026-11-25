import { test } from "node:test";
import assert from "node:assert/strict";
import { missingSettings, missingSettingsText, releaseProblems } from "../src/lib/release-check-pure.ts";

const full = { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k", SUPABASE_SECRET_KEY: "s" };

test("all settings present, no boot result yet -> no problems", () => {
  assert.deepEqual(releaseProblems(full, null), { fatal: [], warn: [] });
});

test("missing or blank public settings are fatal and named", () => {
  assert.deepEqual(missingSettings({ ...full, NEXT_PUBLIC_SUPABASE_URL: "  ", NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined }), ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
  const p = releaseProblems({ ...full, NEXT_PUBLIC_SUPABASE_ANON_KEY: "" }, null);
  assert.equal(p.fatal.length, 1);
  assert.match(p.fatal[0], /NEXT_PUBLIC_SUPABASE_ANON_KEY is missing from \.env\.local.*app:rebuild/);
  assert.match(missingSettingsText(["A", "B"]), /A, B are missing.*Add them/);
});

test("missing secret key and failed migrations warn, never fatal", () => {
  const p = releaseProblems({ ...full, SUPABASE_SECRET_KEY: undefined }, [
    { id: "network", status: "fail" },
    { id: "migrations", status: "fail", detail: "1 of 40 migrations not applied: supabase/migrations/0040_x.sql" },
  ]);
  assert.deepEqual(p.fatal, []);
  assert.equal(p.warn.length, 2);
  assert.match(p.warn[1], /0040_x\.sql/);
});

test("migrations ok or only other checks failing -> no migration warning", () => {
  assert.deepEqual(releaseProblems(full, [{ id: "migrations", status: "ok" }, { id: "ollama", status: "fail" }]).warn, []);
});

test("values are never echoed", () => {
  const p = releaseProblems({ NEXT_PUBLIC_SUPABASE_URL: "https://secret-host", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_SECRET_KEY: "" }, null);
  assert.ok(![...p.fatal, ...p.warn].some((t) => t.includes("secret-host")));
});
