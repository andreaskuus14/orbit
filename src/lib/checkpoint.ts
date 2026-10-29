import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import { noteWrite } from "./durable";
import { projectRecord, projectRecordPrompt } from "./project-record-pure";
import { addLines, checkpointBlocked, checkpointInput, extractCheckpoint, artifactsFromTrace, parseCheckpoint, type Checkpoint, type CpDraft, type CpLine } from "./checkpoint-pure";

// Work checkpoints (logic: checkpoint-pure.ts), stored locally in <ORBIT data dir>/checkpoints.json: user id → chat id → checkpoint.
const file = () => path.join(orbitDataDir(), "checkpoints.json");
const g = globalThis as unknown as { __orbitCheckpoints?: Promise<unknown> };
type All = Record<string, Record<string, unknown>>;

async function readAll(): Promise<All> {
  try {
    const s = JSON.parse(await readFile(file(), "utf8"));
    return s && typeof s === "object" && !Array.isArray(s) ? s : {};
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}; // a locked/corrupt file must never be overwritten
    throw e;
  }
}

export async function getCheckpoint(userId: string, chatId: string): Promise<Checkpoint> {
  return parseCheckpoint((await readAll())[userId]?.[chatId]);
}

/** Serialised read-modify-write; an emptied checkpoint is removed. */
export function updateCheckpoint<T>(userId: string, chatId: string, fn: (cp: Checkpoint) => T): Promise<{ out: T; cp: Checkpoint }> {
  const p = (g.__orbitCheckpoints ?? Promise.resolve()).catch(() => {}).then(async () => {
    const all = await readAll();
    const cp = parseCheckpoint(all[userId]?.[chatId]);
    const out = fn(cp);
    all[userId] = { ...(all[userId] ?? {}) };
    if (cp.lines.length) all[userId][chatId] = cp; else delete all[userId][chatId];
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(all, null, 2));
    await rename(file() + ".tmp", file());
    return { out, cp };
  }).then((r) => { noteWrite("checkpoints.json"); return r; }, (e) => { noteWrite("checkpoints.json", e); throw e; }); // Doctor / Needs-you name it
  g.__orbitCheckpoints = p;
  return p;
}

const add = (userId: string, chatId: string, drafts: CpDraft[], by: CpLine["by"]) =>
  updateCheckpoint(userId, chatId, (cp) => addLines(cp, drafts, by, new Date().toISOString(), randomUUID));

/** Before a CORE turn: capture from the owner's typed message, then return the checkpoint for the prompt. */
export async function noteOwnerTurn(userId: string, chatId: string, message: string): Promise<Checkpoint> {
  const drafts = extractCheckpoint(message);
  return drafts.length ? (await add(userId, chatId, drafts, "owner")).cp : getCheckpoint(userId, chatId);
}

/** After a CORE turn: artifact versions from its write receipts. */
export async function noteReceipts(userId: string, chatId: string, trace: Parameters<typeof artifactsFromTrace>[0]): Promise<void> {
  const drafts = artifactsFromTrace(trace);
  if (drafts.length) await add(userId, chatId, drafts, "orbit");
}

/** CORE tool save_checkpoint (T2: his own data; lines can be edited or deleted on the Checkpoint card). */
export async function runCheckpointTool(userId: string, chatId: string | undefined, input: Record<string, unknown>, question: string): Promise<string> {
  const blocked = checkpointBlocked(question);
  if (blocked) return `Error: ${blocked}`;
  if (!chatId) return "Error: checkpoints only work in a CORE chat";
  const drafts = checkpointInput(input);
  if (typeof drafts === "string") return drafts;
  const { out } = await add(userId, chatId, drafts, "core");
  return out.length ? `Saved to this chat's checkpoint: ${out.map((l) => `${l.kind}: ${l.text}`).join("; ")}. He can edit or delete lines on the Checkpoint card in the chat list.` : "Already in this chat's checkpoint; nothing changed.";
}

/** The chat's project record (project-record-pure.ts): its other chats' checkpoints, merged at read time. "" outside a project. */
export async function projectRecordFor(userId: string, chatId: string): Promise<string> {
  const [{ getChats }, all] = await Promise.all([import("./core-chats"), readAll()]);
  return projectRecordPrompt(projectRecord(await getChats(userId), chatId, all[userId] ?? {}));
}
