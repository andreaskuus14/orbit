import { requireUser } from "@/lib/supabase/server";
import { capsuleView, previewRestore, restoreCapsule, runBackup, setupCapsule } from "@/lib/capsule";

export const dynamic = "force-dynamic";

// Profile → Time capsule. GET: setup, last result, backups in the folder.
// POST {action:"setup", dir, maxMB, passphrase?} | {action:"backup"} | {action:"preview", name, passphrase} | {action:"restore", name, passphrase}.
// The passphrase is never logged or stored; it only opens the chosen backup.
export async function GET() {
  const { res } = await requireUser();
  if (res) return res;
  return Response.json(await capsuleView());
}

export async function POST(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "JSON body required" }, { status: 400 });
  try {
    if (b.action === "setup") { const e = await setupCapsule(b); return e ? Response.json({ error: e }, { status: 400 }) : GET(); }
    if (b.action === "backup") return Response.json({ backup: await runBackup() });
    if (b.action === "preview") return Response.json({ preview: await previewRestore(b.name, b.passphrase) });
    if (b.action === "restore") return Response.json({ restored: await restoreCapsule(b.name, b.passphrase) });
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
