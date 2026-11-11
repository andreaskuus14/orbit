import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, scryptSync, type KeyObject } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

// Time capsule: nightly encrypted backup of ORBIT's local data dir (IO: capsule.ts). Everything here is pure (no fs).
// Crypto: the passphrase → scrypt → AES-256-GCM key that wraps an X25519 private key. Nightly backups only need the public key
// (ephemeral ECDH → HKDF → AES-256-GCM), so ORBIT never keeps the passphrase or any key that can decrypt a backup.
// Each file carries its own wrapped private key + salt, so a backup opens on a new PC with just the file and the passphrase.

export const MAGIC = Buffer.from("ORBITCAP");
export const VERSION = 1;
const KDF = { N: 1 << 15, r: 8, p: 1 };
const MAXMEM = 64 * 1024 * 1024; // 128·N·r = 32 MiB; Node's default cap is exactly that, so raise it
export const MIN_PASSPHRASE = 10;

type Sealed = { iv: string; ct: string; tag: string };
/** Stored in time-capsule.json: the verifier (a wrapped private key only the passphrase opens) and the public key. */
export type Keyring = { pub: string; salt: string; kdf: typeof KDF; wrapped: Sealed };
export type Kind = "nightly" | "pre-restore";
export type Header = { v: number; at: string; kind: Kind; files: number; bytes: number; ring: Keyring; epk: string; iv: string };

const b64 = (b: Buffer) => b.toString("base64");
const unb64 = (s: string) => Buffer.from(s, "base64");
const passKey = (pass: string, salt: Buffer, k: typeof KDF) => scryptSync(pass.normalize("NFKC"), salt, 32, { ...k, maxmem: MAXMEM });

function gcm(key: Buffer, data: Buffer, aad?: Buffer) {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key, iv);
  if (aad) c.setAAD(aad);
  const ct = Buffer.concat([c.update(data), c.final()]);
  return { iv, ct, tag: c.getAuthTag() };
}
function ungcm(key: Buffer, iv: Buffer, ct: Buffer, tag: Buffer, aad?: Buffer) {
  const d = createDecipheriv("aes-256-gcm", key, iv);
  if (aad) d.setAAD(aad);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]); // throws on a wrong key or any changed byte
}

/** Once, at setup: a fresh X25519 pair; the private half is sealed with the passphrase. */
export function makeKeyring(pass: string): Keyring {
  if (pass.length < MIN_PASSPHRASE) throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters`);
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const salt = randomBytes(16), s = gcm(passKey(pass, salt, KDF), privateKey.export({ type: "pkcs8", format: "der" }));
  return { pub: b64(publicKey.export({ type: "spki", format: "der" })), salt: b64(salt), kdf: { ...KDF }, wrapped: { iv: b64(s.iv), ct: b64(s.ct), tag: b64(s.tag) } };
}

/** The private key, or null for a wrong passphrase (this is the verifier check). */
export function unlock(ring: Keyring, pass: string): KeyObject | null {
  try {
    const w = ring.wrapped, der = ungcm(passKey(pass, unb64(ring.salt), ring.kdf), unb64(w.iv), unb64(w.ct), unb64(w.tag));
    return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  } catch { return null; }
}

const dataKey = (shared: Buffer, epk: Buffer) => Buffer.from(hkdfSync("sha256", shared, epk, "orbit-capsule v1", 32));

function frame(h: Header): Buffer {
  const json = Buffer.from(JSON.stringify(h)), len = Buffer.alloc(4);
  len.writeUInt32BE(json.length);
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), len, json]);
}

/** File = MAGIC | version byte | u32 header length | header JSON | ciphertext | 16-byte tag. The whole prefix is GCM AAD. */
export function seal(ring: Keyring, payload: Buffer, meta: { at: string; kind: Kind; files: number; bytes: number }): Buffer {
  const eph = generateKeyPairSync("x25519"), epk = eph.publicKey.export({ type: "spki", format: "der" });
  const key = dataKey(diffieHellman({ privateKey: eph.privateKey, publicKey: createPublicKey({ key: unb64(ring.pub), format: "der", type: "spki" }) }), epk);
  const iv = randomBytes(12);
  const head = frame({ v: VERSION, ...meta, ring, epk: b64(epk), iv: b64(iv) });
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(head);
  return Buffer.concat([head, c.update(payload), c.final(), c.getAuthTag()]);
}

/** Parses the unencrypted header (no passphrase needed: date, kind, counts). Throws on anything that isn't a capsule. */
export function readHeader(buf: Buffer): { header: Header; end: number } {
  if (buf.length < MAGIC.length + 5 || !buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not an ORBIT backup file");
  if (buf[MAGIC.length] !== VERSION) throw new Error(`Unsupported backup version ${buf[MAGIC.length]}`);
  const len = buf.readUInt32BE(MAGIC.length + 1), end = MAGIC.length + 5 + len;
  if (len > 1 << 20 || end + 16 > buf.length) throw new Error("Backup file is damaged");
  const h = JSON.parse(buf.subarray(MAGIC.length + 5, end).toString("utf8")) as Header;
  if (!h?.ring?.wrapped || typeof h.epk !== "string" || typeof h.iv !== "string") throw new Error("Backup file is damaged");
  return { header: h, end };
}

/** Decrypts a capsule. Throws "Wrong passphrase" or "Backup file is damaged". */
export function openCapsule(buf: Buffer, pass: string): { header: Header; payload: Buffer } {
  const { header, end } = readHeader(buf);
  const priv = unlock(header.ring, pass);
  if (!priv) throw new Error("Wrong passphrase");
  const epk = unb64(header.epk);
  const key = dataKey(diffieHellman({ privateKey: priv, publicKey: createPublicKey({ key: epk, format: "der", type: "spki" }) }), epk);
  try { return { header, payload: ungcm(key, unb64(header.iv), buf.subarray(end, buf.length - 16), buf.subarray(buf.length - 16), buf.subarray(0, end)) }; }
  catch { throw new Error("Backup file is damaged"); }
}

// ---- What goes in ---------------------------------------------------------------

export type Entry = { path: string; size: number }; // path: relative to the data dir, "/" separated
export const CONFIG_FILE = "time-capsule.json"; // never backed up or restored: it holds the folder, the limit and the verifier

/** Which files to back up: the *.json / *.jsonl stores, the vault index and the vault metadata (file ids); no caches, temp files, vault contents or files over maxBytes. */
export function pickFiles(all: Entry[], maxBytes: number): { keep: Entry[]; skipped: Entry[] } {
  const keep: Entry[] = [], skipped: Entry[] = [];
  for (const e of all) {
    const parts = e.path.split("/"), name = parts[parts.length - 1];
    const store = /\.jsonl?$/i.test(name) && !parts.some((p) => /cache/i.test(p)) && e.path !== CONFIG_FILE
      && (parts[0] !== "vault" || e.path === "vault/.index.json" || e.path === "vault/.meta.json");
    if (!store) continue;
    (e.size > maxBytes ? skipped : keep).push(e);
  }
  return { keep, skipped };
}

/** A relative path that stays inside the data dir, or null. Used on every path read back out of a backup. */
export function safeRel(p: unknown): string | null {
  if (typeof p !== "string" || !p || p.length > 500 || p.includes("\0") || p.includes("\\")) return null;
  const parts = p.split("/");
  return parts.some((x) => !x || x === "." || x === "..") || /^[a-z]:/i.test(p) ? null : p;
}

export type PackedFile = { path: string; data: Buffer };
export const packFiles = (files: PackedFile[]) => gzipSync(Buffer.from(JSON.stringify({ files: files.map((f) => ({ path: f.path, data: b64(f.data) })) })));
export function unpackFiles(buf: Buffer): PackedFile[] {
  const j = JSON.parse(gunzipSync(buf).toString("utf8")) as { files?: { path?: unknown; data?: unknown }[] };
  return (j.files ?? []).flatMap((f) => { const p = safeRel(f.path); return p && p !== CONFIG_FILE && typeof f.data === "string" ? [{ path: p, data: unb64(f.data) }] : []; });
}

// ---- Restore preview ------------------------------------------------------------

export type ManifestItem = { path: string; size: number; sha: string };
export const manifest = (files: PackedFile[]): ManifestItem[] =>
  files.map((f) => ({ path: f.path, size: f.data.length, sha: createHash("sha256").update(f.data).digest("hex") })).sort((a, b) => a.path.localeCompare(b.path));

/** What a restore would do: create files that are gone, overwrite changed ones; files only on disk now are kept as they are. */
export function diffManifests(now: ManifestItem[], backup: ManifestItem[]) {
  const cur = new Map(now.map((m) => [m.path, m])), inBackup = new Set(backup.map((m) => m.path));
  return {
    create: backup.filter((b) => !cur.has(b.path)).map((b) => b.path),
    overwrite: backup.filter((b) => cur.has(b.path) && cur.get(b.path)!.sha !== b.sha).map((b) => b.path),
    same: backup.filter((b) => cur.get(b.path)?.sha === b.sha).length,
    keep: now.filter((m) => !inBackup.has(m.path)).map((m) => m.path),
  };
}

// ---- Names and rotation ---------------------------------------------------------

export const EXT = ".orbitcap";
export const KEEP_NIGHTLY = 14, KEEP_WEEKLY = 8, KEEP_SAFETY = 3;
/** orbit-capsule-2026-10-26.orbitcap (one per day) or orbit-capsule-pre-restore-2026-10-26T21-05-09.orbitcap. */
export const capsuleName = (kind: Kind, at: Date) =>
  kind === "nightly" ? `orbit-capsule-${at.toISOString().slice(0, 10)}${EXT}` : `orbit-capsule-pre-restore-${at.toISOString().slice(0, 19).replace(/:/g, "-")}${EXT}`;

export function parseName(n: string): { kind: Kind; day: string } | null {
  const m = /^orbit-capsule-(pre-restore-)?(\d{4}-\d{2}-\d{2})(T\d{2}-\d{2}-\d{2})?\.orbitcap$/.exec(n);
  if (!m || !!m[1] !== !!m[3] || Number.isNaN(Date.parse(m[2]))) return null;
  return { kind: m[1] ? "pre-restore" : "nightly", day: m[2] };
}

const week = (day: string) => Math.floor((Date.parse(day) / 86_400_000 + 3) / 7); // Monday-based (1970-01-01 was a Thursday)

/** Names to delete: keeps the newest 14 nightly, the newest one of each of the 8 latest weeks, and the newest 3 safety backups.
 *  Names it doesn't recognise are never deleted. */
export function rotate(names: string[]): string[] {
  const nightly = names.filter((n) => parseName(n)?.kind === "nightly").sort().reverse(); // ISO dates sort by name
  const safety = names.filter((n) => parseName(n)?.kind === "pre-restore").sort().reverse();
  const keep = new Set([...nightly.slice(0, KEEP_NIGHTLY), ...safety.slice(0, KEEP_SAFETY)]);
  const weeks = new Set<number>();
  for (const n of nightly) {
    const w = week(parseName(n)!.day);
    if (weeks.has(w)) continue;
    if (weeks.size >= KEEP_WEEKLY) break;
    weeks.add(w); keep.add(n);
  }
  return [...nightly, ...safety].filter((n) => !keep.has(n));
}

export const fmtMB = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${Math.round(bytes / (1024 * 1024))} MB`);

/** The scheduler's safety net for a host that never runs the night shift (always on, or the night shift is off): back up when
 *  no backup succeeded for 26 h (the night shift's 20 h rule goes first), and retry a failure (drive unplugged) every 6 h. */
export function fallbackDue(last: { at: string; ok: boolean } | undefined, now: number): boolean {
  if (!last) return true;
  const age = now - Date.parse(last.at);
  if (!(age >= 0)) return true; // unreadable or future date: back up (that rewrites it) rather than go without
  return age >= (last.ok ? 26 : 6) * 3_600_000;
}
