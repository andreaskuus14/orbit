// Shortcuts & Watch (roadmap D4), server glue: the Shortcut tokens file and the pending approve-next challenge per Shortcut.
// Rules: remote-shortcut-pure.ts; route: /api/remote/shortcut; created/revoked in Profile → Phone remote (/api/remote/owner).
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "@/lib/data-dir";
import { remoteSecret } from "@/lib/remote";
import { isShortcutAction, newShortcutToken, shortcutHash, shortcutName, type Challenge, type Shortcut, type ShortcutAction } from "@/lib/remote-shortcut-pure";

const g = globalThis as unknown as { __orbitShortcut?: { save?: Promise<unknown>; challenges: Map<string, Challenge> } };
export const SC = (g.__orbitShortcut ??= { challenges: new Map() });

// <data dir>/remote-shortcuts.json: names, actions and token HMACs (never the tokens).
const file = () => path.join(orbitDataDir(), "remote-shortcuts.json");
export async function listShortcuts(): Promise<Shortcut[]> {
  try {
    const v = JSON.parse(await readFile(file(), "utf8"));
    return Array.isArray(v) ? v.filter((s) => s && typeof s.id === "string" && typeof s.hash === "string" && typeof s.userId === "string" && isShortcutAction(s.action)) : [];
  } catch { return []; }
}
function update(fn: (s: Shortcut[]) => Shortcut[]): Promise<Shortcut[]> {
  const p = (SC.save ?? Promise.resolve()).catch(() => {}).then(async () => {
    const next = fn(await listShortcuts());
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(next, null, 1));
    await rename(file() + ".tmp", file());
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
