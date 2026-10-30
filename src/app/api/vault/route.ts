import { requireUser } from "@/lib/supabase/server";
import { VaultError, cloudList, cloudOnlyNames, cloudMove, cloudPut, cloudRemove, deleteFile, listDetailed, listTrash, markSync, previewText, purgeTrash, readStream, renameFile, restoreFromCloud, restoreTrash, saveUpload, searchVaultInfo, syncToCloud, usage } from "@/lib/vault";
import { logActivity } from "@/lib/activity";
import { MAX_FILE, mergeCloud, serveHeaders } from "@/lib/vault-pure";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fail(e: unknown) {
  if (e instanceof VaultError) return Response.json({ error: e.message }, { status: e.status });
  console.error("[vault]", e);
  return Response.json({ error: "Vault operation failed" }, { status: 500 });
}

// VAULT:
//   GET                         → { files (with id, version, hash, sync state, coverage, cloud), cloudOnly, cloudError, trash, usage }
//   GET ?file=name&raw=1        → the file (Range supported), strict headers
//   GET ?file=name&preview=1    → { text, truncated } (text/code only, first 20 KB)
//   GET ?q=text&content=1       → { results: [{ name, snippet }], notIndexed: [name] }
export async function GET(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  const q = new URL(req.url).searchParams;
  try {
    const file = q.get("file");
    if (file !== null && q.get("raw") === "1") {
      const { size, range, stream } = await readStream(file, req.headers.get("range"));
      if (range === "bad" || !stream) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      const headers: Record<string, string> = { ...serveHeaders(file), "Accept-Ranges": "bytes" };
      if (!range) return new Response(stream, { headers: { ...headers, "Content-Length": String(size) } });
      return new Response(stream, { status: 206, headers: { ...headers, "Content-Length": String(range[1] - range[0] + 1), "Content-Range": `bytes ${range[0]}-${range[1]}/${size}` } });
    }
    if (file !== null && q.get("preview") === "1") return Response.json(await previewText(file));
    if (q.get("content") === "1") return Response.json(await searchVaultInfo(q.get("q") ?? "", 50));
    let cloud: Map<string, number> | null = null, cloudError: string | null = null;
    try { cloud = await cloudList(sb, user.id); } catch (e) { cloudError = e instanceof Error ? e.message : "cloud unavailable"; }
    const files = await listDetailed(cloud);
    return Response.json({ ...mergeCloud(files, cloud), cloudError, trash: await listTrash(), usage: await usage(files) });
  } catch (e) { return fail(e); }
}

// POST multipart (field "file", one or more) → upload (+ cloud copy) → { saved, errors, cloud: "ok" | "failed: …" }
// POST JSON { action: "rename", name, to } | { action: "sync" } | { action: "restore", name } | { action: "untrash" | "purge", id }
export async function POST(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.startsWith("multipart/form-data")) {
      // Refuse oversize bodies before parsing them (the panel sends one file per request).
      const len = Number(req.headers.get("content-length") ?? NaN);
      if (!Number.isSafeInteger(len) || len <= 0) return Response.json({ error: "Content-Length required" }, { status: 411 });
      if (len > MAX_FILE + 1024 * 1024) return Response.json({ error: "Files can be at most 40 MB" }, { status: 413 });
      const form = await req.formData().catch(() => null);
      const files = form?.getAll("file").filter((f): f is File => f instanceof File) ?? [];
      if (!files.length) return Response.json({ error: "No file uploaded" }, { status: 400 });
      const taken = await cloudOnlyNames(sb, user.id);
      const saved: string[] = [], sizes: number[] = [];
      const errors: string[] = [];
      for (const f of files) {
        try { saved.push(await saveUpload(f, { taken })); sizes.push(f.size); } catch (e) { errors.push(`${f.name}: ${e instanceof VaultError ? e.message : "could not save"}`); if (!(e instanceof VaultError)) console.error("[vault]", e); }
      }
      // The cloud copy never fails the local save. Big files upload in the background so the request can't time out;
      // until then the listing shows them as not in the cloud, and Sync now retries any that failed.
      let cloud = "ok";
      for (const [i, n] of saved.entries()) {
        if (sizes[i] > 10 * 1024 * 1024) {
          await markSync(n, "pending");
          void cloudPut(sb, user.id, n).then((r) => { if (r !== "ok") console.warn("[vault] cloud copy", n, r); }, (e) => console.warn("[vault] cloud copy", n, e));
          if (cloud === "ok") cloud = "pending";
          continue;
        }
        const r = await cloudPut(sb, user.id, n);
        if (r !== "ok" && !cloud.startsWith("failed")) cloud = r;
      }
      return Response.json({ saved, errors, cloud }, { status: saved.length ? 201 : 400 });
    }
    const body = await req.json().catch(() => null) as { action?: unknown; name?: unknown; to?: unknown } | null;
    if (body?.action === "sync") return Response.json(await syncToCloud(sb, user.id));
    if (body?.action === "untrash") { // back from the trash, then a fresh cloud copy (it was removed on delete)
      const name = await restoreTrash((body as { id?: unknown }).id, await cloudOnlyNames(sb, user.id));
      return Response.json({ name, cloud: await cloudPut(sb, user.id, name) });
    }
    if (body?.action === "purge") { await purgeTrash((body as { id?: unknown }).id); return Response.json({ ok: true }); }
    if (body?.action === "restore") return Response.json({ name: await restoreFromCloud(sb, user.id, body.name) }, { status: 201 });
    if (body?.action !== "rename" || typeof body.to !== "string" || !body.to.trim()) return Response.json({ error: "Expected { action: 'rename' | 'sync' | 'restore', … }" }, { status: 400 });
    const from = body.name as string; // validated by renameFile
    const name = await renameFile(body.name, body.to, await cloudOnlyNames(sb, user.id));
    if (name !== from) logActivity({ area: "system", title: `VAULT "${from}" renamed to "${name}"`, undo: { kind: "vault-rename", id: name, to: from } });
    return Response.json({ name, cloud: name === from ? "ok" : await cloudMove(sb, user.id, from, name) });
  } catch (e) { return fail(e); }
}

// DELETE JSON { name } → moves the file to the trash on this PC (restorable for TRASH_DAYS) and removes its cloud copy.
export async function DELETE(req: Request) {
  const { sb, user, res } = await requireUser();
  if (res) return res;
  try {
    const body = await req.json().catch(() => null) as { name?: unknown } | null;
    const { id, name } = await deleteFile(body?.name);
    return Response.json({ ok: true, id, cloud: await cloudRemove(sb, user.id, name) });
  } catch (e) { return fail(e); }
}
