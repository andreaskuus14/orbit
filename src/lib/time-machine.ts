import { createHash, randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir.ts";
import { inverse, isSafeBranch, parseRecords, recordable, recordBlock, TM_ID, TM_MAX, isOpen, type Current, type MemState, type TmChange, type TmRecord, type VaultState } from "./time-machine-pure.ts";

// TIME MACHINE IO (rules: time-machine-pure.ts). <ORBIT data dir>/time-machine/records.jsonl (append-only, newest TM_MAX kept) and
// blobs/<sha256> (file versions, so a file can be put back and then forward again). Local only: nothing here goes to a model.

const dir = () => path.join(orbitDataDir(), "time-machine");
const recFile = () => path.join(dir(), "records.jsonl");
const blobDir = () => path.join(dir(), "blobs");
const g = globalThis as unknown as { __orbitTm?: { chain: Promise<unknown> } };
const S = (g.__orbitTm ??= { chain: Promise.resolve() });
const serial = <T>(fn: () => Promise<T>): Promise<T> => { const p = S.chain.catch(() => {}).then(fn); S.chain = p.catch(() => {}); return p; };

export const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
export const newTmId = () => `tm${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;

export async function putBlob(bytes: Uint8Array | string): Promise<string> {
  const h = sha(bytes), f = path.join(blobDir(), h);
  await mkdir(blobDir(), { recursive: true });
  if (!(await readFile(f).then(() => true, () => false))) { await writeFile(`${f}.tmp`, bytes); await rename(`${f}.tmp`, f); }
  return h;
}
const getBlob = (h: string) => readFile(path.join(blobDir(), h));

export async function readRecords(): Promise<TmRecord[]> {
  await S.chain.catch(() => {});
  return parseRecords(await readFile(recFile(), "utf8").catch(() => ""));
}

async function append(r: TmRecord) {
  await mkdir(dir(), { recursive: true });
  await appendFile(recFile(), "\n" + JSON.stringify(r));
  const recs = parseRecords(await readFile(recFile(), "utf8"));
  if (recs.length > TM_MAX + 200) { // rotate: keep the newest, drop file versions nothing points to any more
    const keep = recs.slice(-TM_MAX);
    await writeFile(recFile() + ".tmp", keep.map((x) => JSON.stringify(x)).join("\n") + "\n");
    await rename(recFile() + ".tmp", recFile());
    const used = new Set(keep.flatMap((x) => x.changes.flatMap((c) => (c.t === "file" ? [c.before, c.after] : []))));
    for (const b of await readdir(blobDir()).catch(() => [] as string[])) if (!used.has(b)) await unlink(path.join(blobDir(), b)).catch(() => {});
  }
}

/** Write one change set (journal-like changes are dropped first). Never throws: returns the id, or null when nothing was recordable. */
export function recordTm(r: { title: string; why?: string; changes: TmChange[]; undid?: string }, id = newTmId()): Promise<string | null> {
  const changes = r.changes.filter(recordable);
  if (!changes.length) return Promise.resolve(null);
  return serial(async () => { await append({ id, at: new Date().toISOString(), title: r.title.slice(0, 300), ...(r.why ? { why: r.why.slice(0, 300) } : {}), changes, ...(r.undid ? { undid: r.undid } : {}) }); return id; })
    .catch((e) => { console.error("[orbit] time machine record failed:", e instanceof Error ? e.message : e); return null; });
}

// ---- hooks the write paths call ----

/** CORE's workspace writes: before = the file's bytes before (null: it's new). */
export async function recordWsWrites(ws: string, files: { path: string; before: Uint8Array | null; after: Uint8Array | string }[], why: string): Promise<string | null> {
  try {
    const changes: TmChange[] = [];
    for (const f of files) changes.push({ t: "file", ws, path: f.path, before: f.before ? await putBlob(f.before) : null, after: await putBlob(f.after) });
    const n = files.length, created = files.filter((f) => !f.before).length;
    return recordTm({ title: `Workspace ${ws}: ${n === 1 ? `${files[0].path} ${created ? "created" : "changed"}` : `${n} files written`}`, why, changes });
  } catch (e) { console.error("[orbit] time machine:", e instanceof Error ? e.message : e); return null; }
}
export const recordVaultMade = (name: string, why: string) => recordTm({ title: `VAULT: made "${name}"`, why, changes: [{ t: "vault", before: null, after: { name } }] });
export const recordMemoryEdit = (id: string, before: MemState, after: MemState, why: string) => recordTm({ title: `Memory changed: ${after.title.slice(0, 120)}`, why, changes: [{ t: "memory", id, before, after }] });
export const recordSetting = (area: string, from: string, to: string) => recordTm({ title: `Autonomy: ${area} ${from} → ${to}`, why: "Profile → Autonomy", changes: [{ t: "setting", key: `autonomy:${area}`, before: from, after: to }] });
export const recordBranch = (name: string, commit: string, why: string) => recordTm({ title: `Code fix branch ${name}`, why, changes: [{ t: "branch", name, before: null, after: commit }] });

// ---- reading what is there now, and putting things back ----

type Ctx = { sb: SupabaseClient; userId: string };
const MEM_COLS = "kind, title, content, tags, source";
const toMem = (r: Record<string, unknown> | null): MemState | null => (r ? { kind: String(r.kind), title: String(r.title ?? ""), content: typeof r.content === "string" ? r.content : null, tags: Array.isArray(r.tags) ? (r.tags as string[]) : [], source: typeof r.source === "string" ? r.source : null } : null);
const repo = () => process.cwd(); // the live checkout (same as night-repair.ts)
const isImage = (p: string) => /\.(?:png|jpe?g|webp)$/i.test(p);

async function vaultNow(expect: VaultState): Promise<VaultState> {
  if (!expect) return null;
  const v = await import("./vault.ts");
  if ("trash" in expect) return (await v.listTrash()).some((t) => t.id === expect.trash) ? expect : null;
  return (await v.listVault()).some((f) => f.name === expect.name) ? { name: expect.name } : null;
}

async function current(c: TmChange, x: Ctx): Promise<Current> {
  switch (c.t) {
    case "file": {
      const f = await (await import("./workspace.ts")).readWsFile(x.userId, c.ws, c.path);
      return { t: "file", sha: f ? sha(f.bytes) : null };
    }
    case "vault": return { t: "vault", state: await vaultNow(c.after) };
    case "memory": {
      const { data, error } = await x.sb.from("memories").select(MEM_COLS).eq("id", c.id).neq("kind", "journal").maybeSingle();
      if (error) throw new Error(error.message);
      return { t: "memory", state: toMem(data) };
    }
    case "link": {
      const { data, error } = await x.sb.from("memory_links").select("from_id, to_id, status, reason").eq("id", c.id).eq("user_id", x.userId).maybeSingle();
      if (error) throw new Error(error.message);
      return { t: "link", state: data && (data.status === "suggested" || data.status === "confirmed") ? { from: data.from_id, to: data.to_id, status: data.status, reason: String(data.reason ?? "") } : null };
    }
    case "setting": return { t: "setting", value: (await import("./autonomy.ts")).autonomyLevels()[c.key.slice("autonomy:".length) as never] ?? null };
    case "branch": {
      const G = await import("./night-repair-git.ts");
      const r = await G.git(repo(), ["rev-parse", "--verify", "--quiet", `refs/heads/${c.name}^{commit}`]);
      return { t: "branch", sha: r.code === 0 ? r.out.trim() : null };
    }
  }
}

/** Puts one thing into its "before" state; returns the change as it really happened (from → reached), for the inverse record. */
async function putBack(c: TmChange, x: Ctx): Promise<TmChange> {
  switch (c.t) {
    case "file": {
      const ws = await import("./workspace.ts");
      if (c.before === null) {
        const r = await ws.trashWsFile(x.userId, c.ws, c.path);
        if ("error" in r) throw new Error(r.error);
      } else {
        const b = await getBlob(c.before).catch(() => { throw new Error("The old version is no longer kept"); });
        const r = await ws.writeWsFile(x.userId, c.ws, c.path, isImage(c.path) ? new Uint8Array(b) : b.toString("utf8"));
        if ("error" in r) throw new Error(r.error);
      }
      return { ...c, before: c.after, after: c.before };
    }
    case "vault": {
      const v = await import("./vault.ts");
      const cur = c.after, want = c.before;
      if (!cur) throw new Error("That VAULT file is gone");
      let reached: VaultState;
      if (!want || "trash" in want) { // to the trash (VAULT keeps it there for its trash days)
        if ("trash" in cur) throw new Error("It is already in the trash");
        const t = await v.deleteFile(cur.name);
        await v.cloudRemove(x.sb, x.userId, t.name).catch(() => "");
        reached = { trash: t.id, name: t.name };
      } else if ("trash" in cur) {
        const name = await v.restoreTrash(cur.trash, await v.cloudOnlyNames(x.sb, x.userId));
        await v.cloudPut(x.sb, x.userId, name).catch(() => "");
        reached = { name };
        if (name !== want.name) reached = { name: await v.renameFile(name, want.name, await v.cloudOnlyNames(x.sb, x.userId)).catch(() => name) };
      } else {
        const name = await v.renameFile(cur.name, want.name, await v.cloudOnlyNames(x.sb, x.userId));
        if (name !== cur.name) await v.cloudMove(x.sb, x.userId, cur.name, name).catch(() => "");
        reached = { name };
      }
      return { t: "vault", before: cur, after: reached };
    }
    case "memory": {
      const want = c.before;
      if (!want) {
        const { error } = await x.sb.from("memories").delete().eq("id", c.id);
        if (error) throw new Error(error.message);
      } else {
        const { embed } = await import("./embeddings.ts");
        const e = await embed(`${want.title}\n\n${want.content ?? ""}`, "document", { kind: want.kind, tags: want.tags }).catch(() => null);
        const row = { title: want.title, content: want.content, tags: want.tags, embedding: e ? JSON.stringify(e) : null };
        const { error } = c.after
          ? await x.sb.from("memories").update(row).eq("id", c.id)
          : await x.sb.from("memories").insert({ ...row, id: c.id, user_id: x.userId, kind: want.kind, source: want.source });
        if (error) throw new Error(error.message);
      }
      return { ...c, before: c.after, after: c.before };
    }
    case "link": {
      const want = c.before;
      const { error } = !want ? await x.sb.from("memory_links").delete().eq("id", c.id).eq("user_id", x.userId)
        : c.after ? await x.sb.from("memory_links").update({ status: want.status, reason: want.reason }).eq("id", c.id).eq("user_id", x.userId)
        : await x.sb.from("memory_links").insert({ id: c.id, user_id: x.userId, from_id: want.from, to_id: want.to, status: want.status, reason: want.reason });
      if (error) throw new Error(error.message);
      return { ...c, before: c.after, after: c.before };
    }
    case "setting": {
      const area = c.key.slice("autonomy:".length);
      const r = await (await import("./autonomy.ts")).setAreaLevel(x.sb, x.userId, area, c.before, null, false);
      if (typeof r === "string") throw new Error(r);
      return { ...c, before: c.after, after: c.before };
    }
    case "branch": {
      if (!isSafeBranch(c.name)) throw new Error("Not an ORBIT branch");
      const G = await import("./night-repair-git.ts");
      const args = c.before === null ? ["update-ref", "-d", `refs/heads/${c.name}`, c.after ?? ""] : ["update-ref", `refs/heads/${c.name}`, c.before, c.after ?? ""];
      const r = await G.git(repo(), args);
      if (r.code !== 0) throw new Error(`git: ${r.out.trim().slice(0, 160) || "failed"}`);
      return { ...c, before: c.after, after: c.before };
    }
  }
}

/** One click: reverse a record (or an undo: that is the redo). Checks every thing is still as the record left it first. */
export function undoRecord(sb: SupabaseClient, userId: string, id: string): Promise<{ ok: true; title: string; id: string } | { ok: false; error: string; status: number }> {
  if (!TM_ID.test(id)) return Promise.resolve({ ok: false, error: "Bad id", status: 400 });
  return serial(async () => {
    const recs = parseRecords(await readFile(recFile(), "utf8").catch(() => ""));
    const r = recs.find((x) => x.id === id);
    if (!r) return { ok: false as const, error: "Not in the time machine any more", status: 404 };
    if (!isOpen(r, recs)) return { ok: false as const, error: "Already undone", status: 409 };
    const x = { sb, userId };
    const block = recordBlock(r, await Promise.all(r.changes.map((c) => current(c, x))));
    if (block) return { ok: false as const, error: block, status: 409 };
    const reached: TmChange[] = [];
    try { for (const c of [...r.changes].reverse()) reached.unshift(await putBack(c, x)); }
    catch (e) {
      // partly done: what was put back is recorded too, so it can be undone again; the rest stays as it was
      const msg = e instanceof Error ? e.message : "Undo failed";
      if (reached.length) { const inv = inverse(r, newTmId(), new Date().toISOString(), reached); await append({ ...inv, title: `${inv.title} (partly)`, undid: undefined }); }
      return { ok: false as const, error: reached.length ? `Partly undone: ${msg}` : msg, status: 409 };
    }
    const inv = inverse(r, newTmId(), new Date().toISOString(), reached);
    await append(inv);
    return { ok: true as const, title: inv.title, id: inv.id };
  });
}

/** An Activity-log memory undo (CORE's save_memory) with a redo: the row is kept here before it is deleted. null = use the plain undo. */
export async function undoSavedMemory(sb: SupabaseClient, userId: string, id: string): Promise<{ title: string; id: string } | null> {
  const { data, error } = await sb.from("memories").select(`${MEM_COLS}, storage_path`).eq("id", id).neq("kind", "journal").maybeSingle();
  if (error || !data || data.storage_path) return null; // a file-backed memory: the plain undo (its file goes too)
  const before = toMem(data)!;
  const change: TmChange = { t: "memory", id, before, after: null };
  if (!recordable(change)) return null; // never keep a journal row here
  const del = await sb.from("memories").delete().eq("id", id).select("id");
  if (del.error) throw new Error(del.error.message);
  if (!del.data?.length) throw new Error("Already gone");
  const tm = await recordTm({ title: `Undone: memory "${before.title.slice(0, 100)}" deleted`, changes: [change] });
  return tm ? { title: `Undone: memory deleted`, id: tm } : null;
}
