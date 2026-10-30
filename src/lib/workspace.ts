import { randomBytes } from "node:crypto";
import { zipStore } from "./zip-pure.ts";
import { link, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { envExampleError } from "./ws-server-pure.ts";
import { MAX_WORKSPACES, capError, checkPath, isSlug, isUserId, parsePreviewSeg, previewSeg, previewValid, sameFile, slugify } from "./workspace-pure.ts";

// Workspaces on disk: <ORBIT data dir>/workspaces/<user id>/<slug>/..., like life.json and core-chats.json. Deleting moves the file
// into <slug>/.trash (never a hard delete). Writes are atomic (tmp + rename) and run one at a time so the caps hold.

const dataDir = () => {
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "orbit") : path.join(os.homedir(), ".orbit");
  return process.env.ORBIT_DATA_DIR?.trim() || local;
};
const root = () => path.join(dataDir(), "workspaces");
const userDir = (uid: string) => {
  if (!isUserId(uid)) throw new Error("invalid user");
  return path.join(root(), uid);
};
const wsDir = (uid: string, slug: string) => {
  if (!isSlug(slug)) throw new Error("invalid workspace name");
  return path.join(userDir(uid), slug);
};
/** The workspace folder, only if it is a real directory (not a symlink) whose real path is inside the workspaces root; else null. */
async function realWsDir(uid: string, slug: string): Promise<string | null> {
  const dir = wsDir(uid, slug);
  try {
    if (!(await lstat(dir)).isDirectory()) return null;
    const [r, base] = await Promise.all([realpath(dir), realpath(root())]);
    return r.startsWith(base + path.sep) ? dir : null;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
/** The workspace folder (real, contained) or null; the demo server runner starts there. */
export const workspaceDir = realWsDir;
const FOLD = process.platform === "win32" || process.platform === "darwin";
const TRASH_MAX = 50;
const NONCE = ".nonce";

export type WsFile = { path: string; size: number; mtime: number };
export type WsInfo = { slug: string; files: number; bytes: number; mtime: number; preview: string };

const g = globalThis as unknown as { __orbitWs?: Promise<unknown> };
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = (g.__orbitWs ?? Promise.resolve()).catch(() => {}).then(fn);
  g.__orbitWs = p;
  return p;
}

/** Per-PC secret for preview links (see workspace-pure previewSeg). Created atomically; a key file that isn't 32 bytes is an error. */
let keyP: Promise<Buffer> | undefined;
function previewKey(): Promise<Buffer> {
  return (keyP ??= (async () => {
    const f = path.join(root(), ".preview-key");
    const load = async () => {
      const k = Buffer.from((await readFile(f, "utf8")).trim(), "base64url");
      if (k.length !== 32) throw new Error(`${f} is damaged (not a 32-byte key); delete it to make a new one (old preview links stop working)`);
      return k;
    };
    try { return await load(); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await mkdir(root(), { recursive: true });
    const tmp = `${f}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, randomBytes(32).toString("base64url"), { mode: 0o600 });
    // link() fails if the key exists, so two first requests can't both write one; the loser reads the winner's.
    await link(tmp, f).catch((e) => { if (e.code !== "EEXIST") throw e; }).finally(() => unlink(tmp).catch(() => {}));
    return load();
  })().catch((e) => { keyP = undefined; throw e; }));
}
export const getPreviewKey = previewKey;

/** "/w/<seg>/index.html" (or another file); relative, so it works on the Tailscale phone address too. Always names a file: Next
 *  strips a trailing "/", and "/w/<seg>" would make the page's relative "style.css" resolve to "/w/style.css". */
export async function previewUrl(uid: string, slug: string, file = "index.html"): Promise<string> {
  const f = path.join(wsDir(uid, slug), NONCE);
  const nonce = await readFile(f, "utf8").catch(async (e) => {
    if (e.code !== "ENOENT") throw e;
    const n = randomBytes(16).toString("base64url");
    await writeFile(f, n, { flag: "wx" }).catch((e2) => { if (e2.code !== "EEXIST") throw e2; });
    return readFile(f, "utf8");
  });
  return `/w/${previewSeg(await previewKey(), nonce.trim(), uid, slug, Date.now() / 1000)}/${file.split("/").map(encodeURIComponent).join("/")}`;
}

/** The workspace a preview link segment points at, if its signature, expiry and the workspace's current nonce all check out. */
export async function resolvePreview(seg: string): Promise<{ uid: string; slug: string } | null> {
  const p = parsePreviewSeg(seg);
  if (!p) return null;
  const dir = await realWsDir(p.uid, p.slug);
  const nonce = dir && (await readFile(path.join(dir, NONCE), "utf8").catch(() => ""));
  return nonce && previewValid(await previewKey(), nonce.trim(), p, Date.now() / 1000) ? { uid: p.uid, slug: p.slug } : null;
}

/** Real path inside the workspace (no symlink escapes) or null. The file itself may not exist yet. */
async function inside(dir: string, rel: string): Promise<string | null> {
  const full = path.join(dir, ...rel.split("/"));
  const base = await realpath(dir);
  let probe = full;
  for (;;) { // realpath the deepest part that exists
    try { const r = await realpath(probe); return r === base || r.startsWith(base + path.sep) ? full : null; } catch { /* missing */ }
    const up = path.dirname(probe);
    if (up === probe) return null;
    probe = up;
  }
}

async function walk(dir: string, prefix = ""): Promise<WsFile[]> {
  const out: WsFile[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if ((e.name.startsWith(".") && e.name !== ".env.example") || e.isSymbolicLink()) continue; // .trash, tmp files, links
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), rel)));
    else if (e.isFile()) { const s = await stat(path.join(dir, e.name)); out.push({ path: rel, size: s.size, mtime: s.mtimeMs }); }
  }
  return out;
}

export async function listWorkspaces(uid: string): Promise<WsInfo[]> {
  let names: string[];
  try { names = (await readdir(userDir(uid), { withFileTypes: true })).filter((e) => e.isDirectory() && isSlug(e.name)).map((e) => e.name); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const out = await Promise.all(names.map(async (slug) => {
    const files = await walk(wsDir(uid, slug));
    return { slug, files: files.length, bytes: files.reduce((a, f) => a + f.size, 0), mtime: Math.max(0, ...files.map((f) => f.mtime)), preview: await previewUrl(uid, slug) };
  }));
  return out.sort((a, b) => b.mtime - a.mtime);
}

export async function listFiles(uid: string, slug: string): Promise<WsFile[] | null> {
  const dir = await realWsDir(uid, slug);
  return dir ? (await walk(dir)).sort((a, b) => a.path.localeCompare(b.path)) : null;
}

/** The whole workspace as a store-only .zip (null = no such workspace). Each file goes through readWsFile's path checks. */
export async function zipWorkspace(uid: string, slug: string): Promise<Buffer | null> {
  const files = await listFiles(uid, slug);
  if (!files) return null;
  const read = await Promise.all(files.map(async (f) => ({ path: f.path, bytes: (await readWsFile(uid, slug, f.path))?.bytes })));
  return zipStore(read.filter((f): f is { path: string; bytes: Uint8Array } => !!f.bytes));
}

/** Creates the workspace folder (fine if it already exists). */
export function createWorkspace(uid: string, name: string): Promise<{ slug: string; created: boolean } | { error: string }> {
  const slug = slugify(name);
  if (!slug) return Promise.resolve({ error: "give the workspace a name with letters or digits" });
  return serial(async () => {
    const dir = wsDir(uid, slug);
    try { await lstat(dir); return { slug, created: false }; } catch { /* new */ }
    const n = (await listWorkspaces(uid)).length;
    if (n >= MAX_WORKSPACES) return { error: `you already have ${MAX_WORKSPACES} workspaces` };
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, NONCE), randomBytes(16).toString("base64url")); // new links for a recreated slug
    return { slug, created: true };
  });
}

/** File text, or null when it's missing / not an allowed path. */
export async function readWsFile(uid: string, slug: string, rel: string): Promise<{ text: string; size: number; bytes: Uint8Array } | null> {
  const c = checkPath(rel);
  if ("error" in c) return null;
  try {
    const dir = await realWsDir(uid, slug);
    const full = dir && (await inside(dir, c.path));
    if (!full || !(await lstat(full)).isFile()) return null;
    const buf = await readFile(full);
    return { text: buf.toString("utf8"), size: buf.length, bytes: buf };
  } catch { return null; }
}

export function writeWsFile(uid: string, slug: string, rel: string, content: string): Promise<{ path: string; bytes: number; created: boolean } | { error: string }> {
  const c = checkPath(rel);
  if ("error" in c) return Promise.resolve({ error: c.error });
  if (typeof content !== "string" || content.includes("\0")) return Promise.resolve({ error: "content must be text" });
  const env = c.path.endsWith(".env.example") ? envExampleError(content) : "";
  if (env) return Promise.resolve({ error: env });
  return serial(async () => {
    const dir = await realWsDir(uid, slug);
    const files = dir && (await listFiles(uid, slug));
    if (!dir || !files) return { error: `no workspace "${slug}"` };
    const bytes = Buffer.byteLength(content);
    const old = files.find((f) => sameFile(f.path, c.path, FOLD));
    const cap = capError(bytes, old ? old.size : null, files.length, files.reduce((a, f) => a + f.size, 0));
    if (cap) return { error: cap };
    const full = await inside(dir, c.path);
    if (!full) return { error: "path leaves the workspace" };
    await mkdir(path.dirname(full), { recursive: true });
    if (!(await inside(dir, c.path))) return { error: "path leaves the workspace" }; // re-check after mkdir
    const tmp = path.join(path.dirname(full), `.${path.basename(full)}.${randomBytes(4).toString("hex")}.tmp`);
    await writeFile(tmp, content);
    await rename(tmp, full);
    const stored = await readWsFile(uid, slug, c.path);
    if (!stored || stored.text !== content || stored.size !== bytes)
      return { error: `Write confirmation failed for ${c.path}. The file may exist; inspect it before retrying.` };
    return { path: c.path, bytes, created: !old };
  });
}

// <workspace>/.orbit-check: the site check's screenshots and verdict. A dot folder, so it is never listed, counted in the caps or
// served by the preview (checkPath refuses dot names); the WORKSPACES panel reads it through /api/workspace.
export const CHECK_FILES = ["desktop.png", "phone.png", "result.json"] as const;
export async function checkDir(uid: string, slug: string): Promise<string | null> {
  const dir = await realWsDir(uid, slug);
  if (!dir) return null;
  const d = path.join(dir, ".orbit-check");
  await mkdir(d, { recursive: true });
  return (await lstat(d)).isDirectory() ? d : null; // never write through a link
}
export async function readCheckFile(uid: string, slug: string, name: (typeof CHECK_FILES)[number]): Promise<Buffer | null> {
  if (!CHECK_FILES.includes(name)) return null;
  const dir = await realWsDir(uid, slug);
  const f = dir && path.join(dir, ".orbit-check", name);
  try { return f && (await lstat(path.dirname(f))).isDirectory() && (await lstat(f)).isFile() ? await readFile(f) : null; } catch { return null; }
}

/** Moves the file to <workspace>/.trash/<time>-<random>-<path with / → __>; keeps the newest TRASH_MAX there (bounds disk use). */
export function trashWsFile(uid: string, slug: string, rel: string): Promise<{ trashed: string } | { error: string }> {
  const c = checkPath(rel);
  if ("error" in c) return Promise.resolve({ error: c.error });
  return serial(async () => {
    const dir = await realWsDir(uid, slug);
    const full = dir && (await inside(dir, c.path).catch(() => null));
    if (!dir || !full) return { error: "no such file" };
    try { if (!(await lstat(full)).isFile()) return { error: "no such file" }; } catch { return { error: "no such file" }; }
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}-${c.path.replace(/\//g, "__")}`;
    const trash = path.join(dir, ".trash");
    await mkdir(trash, { recursive: true });
    await rename(full, path.join(trash, name));
    const old = (await readdir(trash)).sort(); // names start with the ISO time: oldest first
    for (const n of old.slice(0, Math.max(0, old.length - TRASH_MAX))) await rm(path.join(trash, n), { force: true, recursive: true });
    return { trashed: name };
  });
}
