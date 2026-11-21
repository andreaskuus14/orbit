// The journal key on this PC (run by tools\backup\setup.ps1; you can also run it yourself from the ORBIT folder):
//   node --experimental-strip-types scripts/journal-key.ts init      make the key once and show the recovery key
//   node --experimental-strip-types scripts/journal-key.ts recover   put the key back from your written-down recovery key
//   node --experimental-strip-types scripts/journal-key.ts status    where the key is and its id (never the key itself)
// LOSING THE KEY AND THE RECOVERY KEY = LOSING THE JOURNAL. Nobody, including ORBIT and Claude, can open it without them.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { orbitDataDir } from "../src/lib/data-dir.ts";
import { KEY_BYTES, keyFileText, keyId, parseKeyFile, parseRecoveryKey, recoveryKey } from "../src/lib/journal-crypt-pure.ts";

try { process.loadEnvFile(".env.local"); } catch { /* no .env.local */ }
const keyFile = path.resolve(process.env.ORBIT_JOURNAL_KEY_FILE?.trim() || path.join(orbitDataDir(), "keys", "journal.key"));
const cmd = process.argv[2] ?? "status";
const die = (m: string): never => { console.error(`\n✖ ${m}`); process.exit(1); };
const current = async () => { try { return parseKeyFile(await readFile(keyFile, "utf8")); } catch { return null; } };

async function save(key: Buffer) {
  await mkdir(path.dirname(keyFile), { recursive: true, mode: 0o700 });
  await writeFile(keyFile + ".tmp", keyFileText(key), { mode: 0o600 });
  await rename(keyFile + ".tmp", keyFile);
  if ((await current())?.equals(key) !== true) die(`The key file ${keyFile} didn't read back: nothing is encrypted yet, try again`);
}

const rl = () => createInterface({ input: process.stdin, output: process.stdout });

if (cmd === "status") {
  const k = await current();
  console.log(k ? `Journal key: ${keyFile} (id ${keyId(k)})` : `No journal key yet (${keyFile}). Run: tools\\backup\\setup.ps1`);
} else if (cmd === "init") {
  const have = await current();
  if (have) { console.log(`A journal key already exists: ${keyFile} (id ${keyId(have)}). Not making a new one.`); process.exit(0); }
  const key = randomBytes(KEY_BYTES), rec = recoveryKey(key), groups = rec.split("-");
  console.log(`
================================================================================
 YOUR JOURNAL RECOVERY KEY  (key id ${keyId(key)})

   ${groups.slice(0, 6).join("-")}
   ${groups.slice(6, 12).join("-")}
   ${groups.slice(12).join("-")}

 Write it on paper or put it in your password manager NOW.
 Your journal is encrypted with this key. If this PC dies or the key file is
 deleted and you don't have this recovery key, YOUR JOURNAL IS GONE FOR GOOD.
 Nobody can recover it: not ORBIT, not Claude, not Supabase.
================================================================================
`);
  const r = rl();
  const typed = (await r.question(`To confirm you saved it, type the LAST group (${groups.length} of ${groups.length}): `)).trim().toUpperCase();
  r.close();
  if (typed !== groups[groups.length - 1]) die("That doesn't match. No key was saved; run setup again when you're ready to write it down.");
  await save(key);
  console.log(`✔ Journal key saved: ${keyFile} (id ${keyId(key)}). It is not in Supabase and not in the repo.`);
} else if (cmd === "recover") {
  const have = await current();
  const r = rl();
  const key = parseRecoveryKey(await r.question("Recovery key (dashes optional): "));
  if (!key) { r.close(); die("That recovery key has a typo (the last group is a check)."); }
  if (have && !have.equals(key!)) {
    const ok = (await r.question(`A different key (id ${keyId(have)}) is already here. Replace it? Entries sealed with it will no longer open. Type REPLACE: `)).trim();
    if (ok !== "REPLACE") { r.close(); die("Kept the current key."); }
    await writeFile(`${keyFile}.replaced-${Date.now()}`, keyFileText(have), { mode: 0o600 }); // never throw a key away
  }
  r.close();
  await save(key!);
  console.log(`✔ Journal key restored: ${keyFile} (id ${keyId(key!)}). Restart ORBIT.`);
} else die(`Unknown command ${cmd}: use init, recover or status`);
