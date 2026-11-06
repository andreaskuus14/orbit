// Isolated checks, last step: stop the test server, remove the local Supabase stack and its volumes, delete the scratch folder
// and the isolated build. Touches nothing else (README.md here).
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const L = createRequire(import.meta.url)("./lib.cjs");
L.stop();
const sb = path.join(L.DIR, "supabase-project");
if (existsSync(sb)) {
  try { execFileSync("npx", ["-y", "supabase@2.120.0", "stop", "--no-backup"], { cwd: sb, stdio: "inherit" }); }
  catch { console.error("cleanup: `supabase stop` failed; remove the supabase_*_orbit-isolated containers with docker if any are left"); }
}
rmSync(L.DIR, { recursive: true, force: true });
rmSync(path.join(L.ROOT, ".next-isolated"), { recursive: true, force: true });
console.log("cleanup: test server, local stack, scratch data and isolated build removed");
