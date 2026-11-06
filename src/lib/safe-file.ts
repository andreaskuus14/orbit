// Store files under the ORBIT data dir. Only a MISSING file reads as empty: a locked (Windows antivirus/indexer), unreadable
// or damaged one throws StoreUnreadable, so a read-modify-write stops before it could save an empty store over his data.
// Writes: a unique tmp per write, fsync, rename (retried while Windows briefly locks the target), queued per file so writes never
// interleave. updateStore queues the whole read-modify-write, so two updates of one file never lose each other's change.
// shortcut: the queue is per process (launch.ps1 runs one server); add a lock file if two ORBIT processes ever share a data dir.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

export class StoreUnreadable extends Error { readonly code = "ORBIT_STORE_UNREADABLE"; }

const unreadable = (file: string, e: unknown) =>
  new StoreUnreadable(`${path.basename(file)} couldn't be read (${(e as NodeJS.ErrnoException).code ?? (e instanceof Error ? e.message : e)}); ORBIT left it untouched and saved nothing`);
function checked(file: string, text: string): string {
  if (text.trim()) try { JSON.parse(text); } catch { throw new StoreUnreadable(`${path.basename(file)} is damaged (not valid JSON); ORBIT left it untouched and saved nothing`); }
  return text;
}

/** The file's text; "" only when it doesn't exist. Throws StoreUnreadable when locked, unreadable or not valid JSON. */
export async function readStore(file: string): Promise<string> {
  let text: string;
  try { text = await readFile(file, "utf8"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return ""; throw unreadable(file, e); }
  return checked(file, text);
}

/** readStore for the few stores read synchronously on hot paths (autonomy, focus, plugins). */
export function readStoreSync(file: string): string {
  let text: string;
  try { text = readFileSync(file, "utf8"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return ""; throw unreadable(file, e); }
  return checked(file, text);
}

const g = globalThis as unknown as { __orbitStoreQueue?: Map<string, Promise<unknown>> };
const queue = (g.__orbitStoreQueue ??= new Map());
function queued<T>(file: string, job: () => Promise<T>): Promise<T> {
  const p = (queue.get(file) ?? Promise.resolve()).catch(() => {}).then(job);
  queue.set(file, p);
  void p.catch(() => {}).finally(() => { if (queue.get(file) === p) queue.delete(file); });
  return p;
}

async function put(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    const fh = await open(tmp, "w");
    try { await fh.writeFile(text); await fh.sync(); } finally { await fh.close(); }
    for (let i = 0; ; i++) { // Windows: antivirus/indexer can briefly lock the target
      try { await rename(tmp, file); return; }
      catch (e) {
        if (i >= 5 || !["EPERM", "EACCES", "EBUSY"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e;
        await new Promise((r) => setTimeout(r, 50 * 2 ** i));
      }
    }
  } catch (e) { await unlink(tmp).catch(() => {}); throw e; } // no tmp left behind
}

/** Atomic, durable replace: a crash or power cut leaves the old file or the new one, never an empty or half one. */
export const writeStore = (file: string, text: string): Promise<void> => queued(file, () => put(file, text));

/** Queued read-modify-write: fn gets the current text ("" = missing) and returns the new text (undefined = no change) and a result.
 *  An unreadable file throws StoreUnreadable before fn runs, so nothing is saved over it. fn must not write this file itself. */
export const updateStore = <T>(file: string, fn: (text: string) => { text?: string; out: T }): Promise<T> =>
  queued(file, async () => { const r = fn(await readStore(file)); if (r.text !== undefined) await put(file, r.text); return r.out; });
