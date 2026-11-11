// W02 disk side: build a workspace site from a brief (site.json) and apply copy edits, through the normal workspace writes
// (writeWsFile: caps, path checks, read-back confirmation). Images must already be in the workspace (the owner's VAULT image,
// a ws_picture_draft slot or a fixture); this module only writes text files and never touches an asset. Pure side: site-brief-pure.ts.
import { type Brief, type CopyEdit, editCopy, parseBrief, renderSite } from "./site-brief-pure.ts";
import { listFiles, readWsFile, writeWsFile } from "./workspace.ts";

async function write(uid: string, slug: string, files: Record<string, string>): Promise<string[]> {
  const errors: string[] = [];
  for (const [p, text] of Object.entries(files)) { const r = await writeWsFile(uid, slug, p, text); if ("error" in r) errors.push(`${p}: ${r.error}`); }
  return errors;
}

/** Validate the brief, check its images are in the workspace, then write the page, CSS, form script, site.json and EXPORT.md. */
export async function buildSite(uid: string, slug: string, input: unknown): Promise<{ brief: Brief; missing: string[] } | { errors: string[] }> {
  const p = parseBrief(input);
  if ("errors" in p) return p;
  const have = new Set(((await listFiles(uid, slug)) ?? []).map((f) => f.path));
  const absent = p.brief.assets.filter((a) => !have.has(a.path)).map((a) => `image ${a.path} is not in workspace ${slug}`);
  if (absent.length) return { errors: absent };
  const errors = await write(uid, slug, renderSite(p.brief));
  return errors.length ? { errors } : p;
}

/** Copy edits on the saved brief: rewrites only index.html, site.json and EXPORT.md (CSS, script and images stay byte-identical). */
export async function editSiteCopy(uid: string, slug: string, edits: CopyEdit[]): Promise<{ brief: Brief; changed: string[] } | { errors: string[] }> {
  const saved = await readWsFile(uid, slug, "site.json");
  if (!saved) return { errors: [`no site.json in ${slug}: build the site from a brief first`] };
  let json: unknown;
  try { json = JSON.parse(saved.text); } catch { return { errors: ["site.json is not valid JSON"] }; }
  const p = parseBrief(json);
  if ("errors" in p) return p;
  const e = editCopy(p.brief, edits);
  if ("error" in e) return { errors: [e.error] };
  const all = renderSite(e.brief);
  const errors = await write(uid, slug, { "index.html": all["index.html"], "site.json": all["site.json"], "EXPORT.md": all["EXPORT.md"] });
  return errors.length ? { errors } : e;
}
