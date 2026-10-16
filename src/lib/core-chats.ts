import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chatContext, emptyChats, parseChats, type ChatStore } from "./core-chats-pure";

// CORE projects, pinned notes and the chat → project map, stored locally in <ORBIT data dir>/core-chats.json like life.json,
// one section per signed-in user. The chats themselves stay in Supabase (conversations/messages).

const file = () => {
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "orbit") : path.join(os.homedir(), ".orbit");
  return path.join(process.env.ORBIT_DATA_DIR?.trim() || local, "core-chats.json");
};
const g = globalThis as unknown as { __orbitChats?: Promise<unknown> };

async function readAll(): Promise<Record<string, unknown>> {
  try {
    const s = JSON.parse(await readFile(file(), "utf8"));
    return s && typeof s === "object" && !Array.isArray(s) ? s : {};
  } catch (e) {
    // Only a missing file means empty; a locked/corrupt file must never be overwritten.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
}

export async function getChats(userId: string): Promise<ChatStore> {
  const all = await readAll();
  return all[userId] ? parseChats(all[userId]) : emptyChats();
}

export function updateChats<T>(userId: string, fn: (s: ChatStore) => T): Promise<T> {
  const p = (g.__orbitChats ?? Promise.resolve()).catch(() => {}).then(async () => {
    const all = await readAll();
    const s = all[userId] ? parseChats(all[userId]) : emptyChats();
    const out = fn(s);
    all[userId] = s;
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(all, null, 2));
    await rename(file() + ".tmp", file());
    return out;
  });
  g.__orbitChats = p;
  return p;
}

/** The project prompt block for a chat (empty when it isn't in a project or the file can't be read); see chatContext. */
export async function chatProjectContext(userId: string, chatId: string): Promise<{ text: string; tainted: boolean }> {
  try { return chatContext(await getChats(userId), chatId); } catch { return { text: "", tainted: false }; }
}
