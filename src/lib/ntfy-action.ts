// Approve / Reject from an ntfy notification, IO side (rules: ntfy-action-pure.ts). The HMAC secret is made once and kept in
// <ORBIT data dir>/ntfy-action.key (never leaves the PC); spent nonces in ntfy-act-used.json. Deleting the key voids every button.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir.ts";
import { markUsed, signAct, verifyAct, type ActToken } from "./ntfy-action-pure";

const keyFile = () => path.join(orbitDataDir(), "ntfy-action.key");
const usedFile = () => path.join(orbitDataDir(), "ntfy-act-used.json");
const g = globalThis as unknown as { __orbitActKey?: Promise<Buffer>; __orbitActChain?: Promise<unknown> };

function secret(): Promise<Buffer> {
  return (g.__orbitActKey ??= (async () => {
    await mkdir(orbitDataDir(), { recursive: true });
    await writeFile(keyFile(), randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 }).catch((e) => { if (e.code !== "EEXIST") throw e; });
    const k = Buffer.from((await readFile(keyFile(), "utf8")).trim(), "hex");
    if (k.length < 32) throw new Error("ntfy-action.key is damaged: delete it (old buttons stop working)");
    return k;
  })().catch((e) => { g.__orbitActKey = undefined; throw e; }));
}

/** A fresh token for one waiting task (put in its notification's buttons). */
export const actToken = async (taskId: string, userId: string, seen?: string) => signAct(await secret(), taskId, userId, Date.now(), undefined, seen);

/** Check the token and spend it (saved before the caller acts: a crash afterwards can't make it usable twice). */
export function spendAct(token: unknown): Promise<ActToken | { error: string }> {
  const p = (g.__orbitActChain ?? Promise.resolve()).catch(() => {}).then(async () => {
    const now = Date.now(), raw: unknown = await readFile(usedFile(), "utf8").then((t) => JSON.parse(t), () => null);
    const used = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, number> : {};
    const v = verifyAct(await secret(), token, now, used);
    if ("error" in v) return v;
    await writeFile(usedFile() + ".tmp", JSON.stringify(markUsed(used, v.n, v.e, now)));
    await rename(usedFile() + ".tmp", usedFile());
    return v;
  });
  g.__orbitActChain = p;
  return p;
}
