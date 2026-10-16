import { spawn } from "node:child_process";
import { requireUser } from "@/lib/supabase/server";
import { ensureDirs, inboxDir } from "@/lib/clips/factory";
import { devlogDir } from "@/lib/clips/inbox-watch";

// Opens the clip inbox (or, with { folder: "devlog" }, the devlog folder) in Windows Explorer so the owner can drop videos in.
export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  if (process.platform !== "win32") return Response.json({ error: "Only available on Windows" }, { status: 501 });
  await ensureDirs();
  const b = (await req.json().catch(() => null)) as { folder?: unknown } | null;
  const dir = b?.folder === "devlog" ? await devlogDir() : inboxDir();
  spawn("explorer.exe", [dir], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  return Response.json({ ok: true, path: dir });
}
