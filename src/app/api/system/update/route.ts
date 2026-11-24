import { stat } from "node:fs/promises";
import { requireUser } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";
import { requestUpdate, updateFlag } from "@/lib/self-update";

export const dynamic = "force-dynamic";

// Owner-only "update ORBIT": writes the flag scripts/launch.ps1's supervisor checks every 5 s. It then pulls main
// (fast-forward only), builds while this server keeps running, and swaps in only a successful build. So a Claude
// session can update ORBIT through its own page, no terminal. Without the supervisor (npm run dev) nothing happens.
// When the pull brings nothing new, nothing is built unless the body is {"rebuild": true} (also retries a commit that failed).
const flag = updateFlag;

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  const s = await stat(flag()).catch(() => null);
  return Response.json({ pending: !!s, requestedAt: s?.mtime.toISOString() ?? null, commit: process.env.ORBIT_BUILD_COMMIT || null });
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const rebuild = ((await req.json().catch(() => null)) as { rebuild?: unknown } | null)?.rebuild === true;
  if (!(await requestUpdate(rebuild))) return Response.json({ error: "Only the production server (scripts/launch.ps1) can update itself" }, { status: 409 });
  logActivity({ area: "system", title: rebuild ? "Update requested: pull main and force a rebuild" : "Update requested: pull main and rebuild if it changed", detail: `from ${process.env.ORBIT_BUILD_COMMIT?.slice(0, 8) || "unknown build"}` });
  return Response.json({ queued: true, note: "The supervisor picks it up within 5 s; progress is in orbit-launcher.log. Nothing is built when main has nothing new (send {\"rebuild\": true} to force it). A new build swaps in when it succeeds (about 10 min) and is rolled back if it doesn't answer, show its pages or keep running for 2 min." });
}
