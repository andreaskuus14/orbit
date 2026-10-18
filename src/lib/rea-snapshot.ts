import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { REA_LIMITS, sourceDirectory, sourceFile } from "./rea-pure.ts";

export type SourceManifest = { files: { path: string; sha256: string; bytes: number }[]; bytes: number; omitted_entries: number; policy: string };
/** A bounded source-only snapshot; target code is read, never imported or executed. */
export async function snapshotSources(source: string, destination: string, signal: AbortSignal, excludedRoots: string[] = []): Promise<SourceManifest> {
  const root = await realpath(source);
  if (!(await lstat(source)).isDirectory()) throw new Error("REA target must be a real source directory, not a symlink or file.");
  const manifest: SourceManifest = { files: [], bytes: 0, omitted_entries: 0, policy: "Source-only snapshot: hidden paths, dependencies, build output, media, non-source files, secret-like filenames and symlinks excluded. It is not a full application image; source may still contain hardcoded secrets. Files are copied over an interval, not an atomic repository snapshot." };
  let visited = 0;
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
    if (depth > 30) throw new Error("Source directory nesting exceeds the analysis budget.");
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      signal.throwIfAborted();
      if (++visited > 20000) throw new Error("Source directory inventory exceeds the analysis budget.");
      const src = path.join(dir, entry.name), rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || excludedRoots.some((r) => src === r || src.startsWith(r + path.sep))) { manifest.omitted_entries++; continue; }
      if (entry.isDirectory()) {
        if (sourceDirectory(entry.name)) await walk(src, rel, depth + 1);
        else manifest.omitted_entries++;
        continue;
      }
      if (!entry.isFile() || !sourceFile(entry.name)) { manifest.omitted_entries++; continue; }
      if (manifest.files.length >= REA_LIMITS.files) throw new Error("Too many source files; register a smaller source directory.");
      const resolved = await realpath(src);
      if (!resolved.startsWith(root + path.sep) || (await lstat(src)).isSymbolicLink()) throw new Error("Source file escaped the selected directory.");
      const handle = await open(src, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let bytes: Buffer;
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.size > REA_LIMITS.fileBytes) throw new Error("A source file exceeds the 1 MiB file budget.");
        const chunks: Buffer[] = []; let size = 0;
        for (;;) {
          signal.throwIfAborted();
          const buffer = Buffer.alloc(64 * 1024);
          const read = await handle.read(buffer, 0, buffer.length, null);
          if (!read.bytesRead) break;
          size += read.bytesRead;
          if (size > REA_LIMITS.fileBytes || manifest.bytes + size > REA_LIMITS.inputBytes) throw new Error("Source snapshot exceeds its byte budget.");
          chunks.push(buffer.subarray(0, read.bytesRead));
        }
        const after = await handle.stat(), current = await lstat(src);
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || current.dev !== after.dev || current.ino !== after.ino || current.isSymbolicLink()) throw new Error("A source file changed while being copied. Retry when edits have stopped.");
        bytes = Buffer.concat(chunks);
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } finally { await handle.close(); }
      const out = path.join(destination, ...rel.split("/"));
      await mkdir(path.dirname(out), { recursive: true, mode: 0o700 });
      await writeFile(out, bytes, { flag: "wx", mode: 0o600 });
      manifest.bytes += bytes.length;
      manifest.files.push({ path: rel, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
    }
  };
  await walk(root, "", 0);
  if (!manifest.files.length) throw new Error("No supported source files found in that target.");
  manifest.files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return manifest;
}
