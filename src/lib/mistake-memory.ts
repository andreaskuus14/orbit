// Failure / Mistake Memory — durable local JSON store (<ORBIT data dir>/mistakes.json).
// Pure matching & privacy wall live in mistake-memory-pure.ts. Never throws on context reads.
import { randomUUID } from "node:crypto";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import { readStore, writeStore } from "./safe-file";
import {
  extractToolFailure,
  formatMistakesBlock,
  matchMistakes,
  parseMistakeStore,
  recordMistakePure,
  type Mistake,
  type MistakeInput,
  type MistakeStore,
} from "./mistake-memory-pure";

const file = () => path.join(orbitDataDir(), "mistakes.json");
const g = globalThis as unknown as { __orbitMistakesLock?: Promise<unknown> };

const load = async (): Promise<MistakeStore> => parseMistakeStore(await readStore(file()));

function update<T>(fn: (s: MistakeStore) => T): Promise<T> {
  const p = (g.__orbitMistakesLock ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await load();
    const out = fn(s);
    await writeStore(file(), JSON.stringify(s));
    return out;
  });
  g.__orbitMistakesLock = p;
  return p;
}

export async function listMistakes(userId: string): Promise<Mistake[]> {
  try {
    return (await load()).users[userId]?.items ?? [];
  } catch {
    return [];
  }
}

export async function addMistake(userId: string, input: MistakeInput): Promise<{ saved: Mistake | null; reason?: string }> {
  return update((s) => {
    const u = (s.users[userId] ??= { items: [] });
    const res = recordMistakePure(u.items, input, new Date().toISOString(), randomUUID);
    u.items = res.items;
    return { saved: res.saved, reason: res.reason };
  });
}

export async function setMistakeStatus(userId: string, id: string, status: "active" | "archived"): Promise<boolean> {
  return update((s) => {
    const items = s.users[userId]?.items;
    const hit = items?.find((m) => m.id === id);
    if (!hit) return false;
    hit.status = status;
    hit.updatedAt = new Date().toISOString();
    return true;
  });
}

export async function deleteMistake(userId: string, id: string): Promise<boolean> {
  return update((s) => {
    const u = s.users[userId];
    if (!u) return false;
    const before = u.items.length;
    u.items = u.items.filter((m) => m.id !== id);
    return u.items.length < before;
  });
}

/** Context block for CORE & agents: returns "" when no past mistake strongly matches `query` (zero prompt bloat). */
export async function mistakesContext(userId: string, query: string, tools?: readonly string[]): Promise<string> {
  try {
    const items = await listMistakes(userId);
    const matches = matchMistakes(items, query, { tools });
    return formatMistakesBlock(matches);
  } catch {
    return "";
  }
}

/** Record a deterministic tool-usage failure for future avoidance (never throws; drops transient/private errors). */
export async function recordToolFailure(userId: string, tool: string, input: Record<string, unknown>, errorText: string): Promise<void> {
  try {
    const cand = extractToolFailure(tool, input, errorText);
    if (cand) await addMistake(userId, cand);
  } catch { /* best-effort only */ }
}
