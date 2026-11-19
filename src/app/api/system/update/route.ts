import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

// Owner-only "update ORBIT": writes the flag scripts/launch.ps1's supervisor checks every 5 s. It then pulls main
// (fast-forward only), builds while this server keeps running, and swaps in only a successful build. So a Claude
// session can update ORBIT through its own page, no terminal. Without the supervisor (npm run dev) nothing happens.
const flag = () => path.join(process.cwd(), "orbit-update.request");

export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  const s = await stat(flag()).catch(() => null);
  return Response.json({ pending: !!s, requestedAt: s?.mtime.toISOString() ?? null, commit: process.env.ORBIT_BUILD_COMMIT || null });
}

export async function POST() {
  const { res } = await requireUser();
  if (res) return res;
  if (process.env.NODE_ENV !== "production") return Response.json({ error: "Only the production server (scripts/launch.ps1) can update itself" }, { status: 409 });
  await writeFile(flag(), new Date().toISOString(), "utf8");
  logActivity({ area: "system", title: "Update requested: pull main and rebuild", detail: `from ${process.env.ORBIT_BUILD_COMMIT?.slice(0, 8) || "unknown build"}` });
  return Response.json({ queued: true, note: "The supervisor picks it up within 5 s; progress is in orbit-launcher.log, the new build swaps in when it succeeds (about 10 min)." });
}
