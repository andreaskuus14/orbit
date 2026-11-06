import { test } from "node:test";
import assert from "node:assert/strict";
import { isolated, isolationProblem } from "../src/lib/isolation-pure.ts";

const safe = { ORBIT_ISOLATED: "1", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9", ORBIT_DATA_DIR: "/tmp/x" };

test("a normal instance is never blocked", () => {
  assert.equal(isolated({}), false);
  assert.equal(isolationProblem({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", SUPABASE_SECRET_KEY: "k" }), null);
});

test("an isolated instance starts only with dummy services, no live keys and its own data folder", () => {
  assert.equal(isolationProblem(safe), null);
  assert.match(isolationProblem({ ...safe, NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" })!, /hosted Supabase/);
  assert.match(isolationProblem({ ...safe, SUPABASE_SECRET_KEY: "k", YOUTUBE_API_KEY: "y" })!, /SUPABASE_SECRET_KEY, YOUTUBE_API_KEY/);
  assert.match(isolationProblem({ ...safe, ORBIT_DATA_DIR: undefined })!, /ORBIT_DATA_DIR/);
  assert.equal(isolationProblem({ ...safe, SUPABASE_SECRET_KEY: "" }), null); // empty = unset
});
