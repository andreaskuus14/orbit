// Shortcuts & Watch (roadmap D4), server glue: the Shortcut tokens file and the pending approve-next challenge per Shortcut.
// Rules: remote-shortcut-pure.ts; route: /api/remote/shortcut; created/revoked in Profile → Phone remote (/api/remote/owner).
import { readStore, writeStore } from "./safe-file.ts";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { orbitDataDir } from "@/lib/data-dir";
import { remoteSecret } from "@/lib/remote";
import { isShortcutAction, newShortcutToken, shortcutHash, shortcutName, type Challenge, type Shortcut, type ShortcutAction } from "@/lib/remote-shortcut-pure";

type State = { save?: Promise<unknown>; challenges: Map<string, Challenge> };
const g = globalThis as unknown as { __orbitShortcut?: State };
export const SC: State = (g.__orbitShortcut ??= { challenges: new Map() });

// <data dir>/remote-shortcuts.json: names, actions and token HMACs (never the tokens).
const file = () => path.join(orbitDataDir(), "remote-shortcuts.json");
/** Strict: the write path must not save over a file it couldn't read. */
async function readShortcuts(): Promise<Shortcut[]> {
  const t = await readStore(file()), v = t ? JSON.parse(t) : []; // missing = none; locked/damaged throws
  return Array.isArray(v) ? v.filter((s) => s && typeof s.id === "string" && typeof s.hash === "string" && typeof s.userId === "string" && isShortcutAction(s.action)) : [];
}
/** For reads (auth, lists): an unreadable file reads as none, as before; nothing is written from here. */
export const listShortcuts = (): Promise<Shortcut[]> => readShortcuts().catch(() => []);
function update(fn: (s: Shortcut[]) => Shortcut[]): Promise<Shortcut[]> {
  const p = (SC.save ?? Promise.resolve()).catch(() => {}).then(async () => {
    const next = fn(await readShortcuts());
    await writeStore(file(), JSON.stringify(next, null, 1));
    return next;
  });
  SC.save = p;
  return p;
}

/** New token for one action; returned once, to show the owner. */
export async function createShortcut(userId: string, action: ShortcutAction, name: unknown): Promise<{ id: string; token: string }> {
  const token = newShortcutToken(randomBytes(32));
  const id = randomBytes(9).toString("base64url");
  await update((list) => [...list, { id, name: shortcutName(name), action, userId, hash: shortcutHash(token, remoteSecret()), createdAt: new Date().toISOString() }]);
  return { id, token };
}
export async function revokeShortcut(id: string) {
  await update((list) => list.filter((s) => s.id !== id));
  SC.challenges.delete(id);
}
