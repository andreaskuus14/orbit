import { requireUser } from "@/lib/supabase/server";
import { deleteDownload, getDownload, startClipQueue } from "@/lib/clips/factory";
import { isDownloadId } from "@/lib/clips/pure";

// Cancels a download (removing its partial files) and forgets it. A finished video stays in the inbox.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { res } = await requireUser();
  if (res) return res;
  startClipQueue();
  const { id } = await params;
  if (!isDownloadId(id)) return Response.json({ error: "Invalid download id" }, { status: 400 });
  if (!(await getDownload(id))) return Response.json({ error: "Download not found" }, { status: 404 });
  await deleteDownload(id);
  return Response.json({ ok: true });
}
