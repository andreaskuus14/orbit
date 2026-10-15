import { spawn } from "node:child_process";
import { requireUser } from "@/lib/supabase/server";
import { ensureDirs, inboxDir } from "@/lib/clips/factory";

// Opens the clip inbox in Windows Explorer so the owner can drop videos in.
export async function POST() {
  const { res } = await requireUser();
  if (res) return res;
  if (process.platform !== "win32") return Response.json({ error: "Only available on Windows" }, { status: 501 });
  await ensureDirs();
  spawn("explorer.exe", [inboxDir()], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  return Response.json({ ok: true, path: inboxDir() });
}
