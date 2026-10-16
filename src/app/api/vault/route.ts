import { requireUser } from "@/lib/supabase/server";
import { VaultError, deleteFile, listVault, previewText, readStream, renameFile, saveUpload, searchVault, usage } from "@/lib/vault";
import { MAX_FILE, serveHeaders } from "@/lib/vault-pure";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fail(e: unknown) {
  if (e instanceof VaultError) return Response.json({ error: e.message }, { status: e.status });
  console.error("[vault]", e);
  return Response.json({ error: "Vault operation failed" }, { status: 500 });
}

// VAULT:
//   GET                         → { files, usage }
//   GET ?file=name&raw=1        → the file (Range supported), strict headers
//   GET ?file=name&preview=1    → { text, truncated } (text/code only, first 20 KB)
//   GET ?q=text&content=1       → { results: [{ name, snippet }] }
export async function GET(req: Request) {
  const { res } = await requireUser();
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
    if (q.get("content") === "1") return Response.json({ results: await searchVault(q.get("q") ?? "", 50) });
    const files = await listVault();
    return Response.json({ files, usage: await usage(files) });
  } catch (e) { return fail(e); }
}

// POST multipart (field "file", one or more) → upload; POST JSON { action: "rename", name, to } → rename.
export async function POST(req: Request) {
  const { res } = await requireUser();
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
      const saved: string[] = [];
      const errors: string[] = [];
      for (const f of files) {
        try { saved.push(await saveUpload(f)); } catch (e) { errors.push(`${f.name}: ${e instanceof VaultError ? e.message : "could not save"}`); if (!(e instanceof VaultError)) console.error("[vault]", e); }
      }
      return Response.json({ saved, errors }, { status: saved.length ? 201 : 400 });
    }
    const body = await req.json().catch(() => null) as { action?: unknown; name?: unknown; to?: unknown } | null;
    if (body?.action !== "rename" || typeof body.to !== "string" || !body.to.trim()) return Response.json({ error: "Expected { action: 'rename', name, to }" }, { status: 400 });
    return Response.json({ name: await renameFile(body.name, body.to) });
  } catch (e) { return fail(e); }
}

// DELETE JSON { name } → permanently removes that vault file.
export async function DELETE(req: Request) {
  const { res } = await requireUser();
  if (res) return res;
  try {
    const body = await req.json().catch(() => null) as { name?: unknown } | null;
    await deleteFile(body?.name);
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}
