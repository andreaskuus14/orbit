// Journal / LIFE encryption at rest (AES-256-GCM, Node crypto). The key lives only on the owner's PC (journal-key.ts); it is
// never in Supabase, never in the repo. Rules and the one-time migration plan are here (tested in tests/journal-crypt.test.ts).
// A sealed value: "ojx1:<key id>:<base64url(iv 12 | tag 16 | ciphertext)>". The AAD names the field (and the day or the owner),
// so a sealed value can't be moved to another field or day without failing to open.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const PREFIX = "ojx1:";
export const KEY_BYTES = 32;
const IV = 12, TAG = 16;

export const isSealed = (s: unknown): s is string => typeof s === "string" && s.startsWith(PREFIX);
/** First 8 hex chars of sha256(key): tells "wrong key" apart from "damaged" without revealing the key. */
export const keyId = (key: Buffer) => createHash("sha256").update(key).digest("hex").slice(0, 8);
const checkKey = (key: Buffer) => { if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) throw new Error("Journal key must be 32 bytes"); };

export function seal(key: Buffer, plaintext: string, aad: string): string {
  checkKey(key);
  const iv = randomBytes(IV), c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return `${PREFIX}${keyId(key)}:${Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url")}`;
}

/** Throws on a wrong key, a wrong AAD or any tampering (GCM tag check). */
export function open(key: Buffer, sealed: string, aad: string): string {
  checkKey(key);
  if (!isSealed(sealed)) throw new Error("Not a sealed journal value");
  const [kid, body] = sealed.slice(PREFIX.length).split(":");
  if (kid !== keyId(key)) throw new Error(`Sealed with another key (${kid}); this PC's key is ${keyId(key)}`);
  const raw = Buffer.from(body ?? "", "base64url");
  if (raw.length < IV + TAG) throw new Error("Sealed journal value is damaged");
  const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV));
  d.setAAD(Buffer.from(aad, "utf8"));
  d.setAuthTag(raw.subarray(IV, IV + TAG));
  return Buffer.concat([d.update(raw.subarray(IV + TAG)), d.final()]).toString("utf8");
}

// ---- AADs: one per stored field ----
export const lifeAad = (date: string) => `orbit/life.json/journal/${date}`;
export const memoryAad = (userId: string, field: "title" | "content") => `orbit/memories/${field}/${userId}`;
export const BACKUP_AAD = "orbit/journal-backup/v1";

// ---- Recovery key: the key in 16 groups of 4 hex chars plus a 4-char check group, for writing down on paper ----
export function recoveryKey(key: Buffer): string {
  checkKey(key);
  const hex = key.toString("hex"), check = createHash("sha256").update(key).digest("hex").slice(0, 4);
  return [...(hex.match(/.{4}/g) ?? []), check].join("-").toUpperCase();
}
/** Recovery key text (any case, spaces or dashes) → key; null when it is mistyped (the check group catches typos). */
export function parseRecoveryKey(text: string): Buffer | null {
  const s = String(text ?? "").replace(/[\s-]/g, "").toLowerCase();
  if (!/^[0-9a-f]{68}$/.test(s)) return null;
  const key = Buffer.from(s.slice(0, 64), "hex");
  const want = createHash("sha256").update(key).digest("hex").slice(0, 4);
  return timingSafeEqual(Buffer.from(want), Buffer.from(s.slice(64))) ? key : null;
}
/** Key file text: one base64 line. */
export const keyFileText = (key: Buffer) => { checkKey(key); return key.toString("base64") + "\n"; };
export function parseKeyFile(text: string): Buffer | null {
  const k = Buffer.from(String(text ?? "").trim(), "base64");
  return k.length === KEY_BYTES ? k : null;
}

// ---- What the owner sees outside LIFE ----
export const LOCKED_NOTE = "Private journal entry, encrypted on this PC. Read it in LIFE → Journal.";
type Row = { kind?: string | null; title?: string | null; content?: string | null; created_at?: string | null };
/** A journal memory row for any list outside LIFE: title "Journal entry · <day>", the locked note as content. Other rows unchanged. */
export function redactJournalRow<T extends Row>(r: T): T & { locked?: true } {
  if (r.kind !== "journal" && !isSealed(r.title) && !isSealed(r.content)) return r;
  return { ...r, title: `Journal entry · ${String(r.created_at ?? "").slice(0, 10) || "undated"}`, content: LOCKED_NOTE, locked: true };
}

// ---- One-time migration (idempotent, reversible) ----
export type JournalRow = { id: string; user_id: string; kind: string; title: string; content: string; has_embedding?: boolean };
export type Sealer = { seal(text: string, aad: string): string; open(sealed: string, aad: string): string };
export const sealer = (key: Buffer): Sealer => ({ seal: (t, a) => seal(key, t, a), open: (s, a) => open(key, s, a) });

/** life.json journal → the days whose plaintext gets sealed, each verified to open back to the same text before it is used. */
export function planLife(journal: Record<string, string>, s: Sealer): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [date, text] of Object.entries(journal ?? {})) {
    if (typeof text !== "string" || isSealed(text)) continue;
    const v = s.seal(text, lifeAad(date));
    if (s.open(v, lifeAad(date)) !== text) throw new Error(`life.json ${date}: sealed value didn't open back to the same text`);
    out[date] = v;
  }
  return out;
}

/** Journal memory rows → updates (sealed title/content, embedding removed). Rows already sealed only lose a leftover embedding. */
export function planRows(rows: JournalRow[], s: Sealer): { id: string; title: string; content: string; old: { title: string; content: string } }[] {
  const out = [];
  for (const r of rows) {
    if (r.kind !== "journal") continue;
    const ta = memoryAad(r.user_id, "title"), ca = memoryAad(r.user_id, "content");
    const title = isSealed(r.title) ? r.title : s.seal(r.title, ta), content = isSealed(r.content) ? r.content : s.seal(r.content ?? "", ca);
    if (title === r.title && content === r.content && !r.has_embedding) continue; // nothing left to do: idempotent
    if (!isSealed(r.title) && s.open(title, ta) !== r.title) throw new Error(`memory ${r.id}: title didn't open back`);
    if (!isSealed(r.content) && s.open(content, ca) !== (r.content ?? "")) throw new Error(`memory ${r.id}: content didn't open back`);
    out.push({ id: r.id, title, content, old: { title: r.title, content: r.content } });
  }
  return out;
}

/** Rollback plan: sealed values → plaintext again (needs the same key). */
export function planLifeOpen(journal: Record<string, string>, s: Sealer): Record<string, string> {
  return Object.fromEntries(Object.entries(journal ?? {}).filter(([, v]) => isSealed(v)).map(([d, v]) => [d, s.open(v, lifeAad(d))]));
}
export function planRowsOpen(rows: JournalRow[], s: Sealer): { id: string; title: string; content: string }[] {
  return rows.filter((r) => r.kind === "journal" && (isSealed(r.title) || isSealed(r.content))).map((r) => ({
    id: r.id,
    title: isSealed(r.title) ? s.open(r.title, memoryAad(r.user_id, "title")) : r.title,
    content: isSealed(r.content) ? s.open(r.content, memoryAad(r.user_id, "content")) : r.content,
  }));
}

/** "No plaintext journal left": every problem found, as plain sentences (empty = clean). */
export function plaintextLeft(input: { life: Record<string, string> | null; rows: JournalRow[]; files?: { name: string; text: string }[] }): string[] {
  const out: string[] = [];
  const days = Object.entries(input.life ?? {}).filter(([, v]) => typeof v === "string" && v && !isSealed(v)).map(([d]) => d);
  if (days.length) out.push(`life.json: ${days.length} journal day(s) in plain text (${days.slice(0, 5).join(", ")}${days.length > 5 ? ", …" : ""})`);
  const rows = input.rows.filter((r) => r.kind === "journal");
  const plain = rows.filter((r) => !isSealed(r.title) || !isSealed(r.content)).length, emb = rows.filter((r) => r.has_embedding).length;
  if (plain) out.push(`Supabase memories: ${plain} journal row(s) with a plain-text title or content`);
  if (emb) out.push(`Supabase memories: ${emb} journal row(s) still have an embedding`);
  for (const f of input.files ?? []) {
    const n = plainJournalIn(f.text);
    if (n) out.push(`${f.name}: ${n} plain-text journal entr${n === 1 ? "y" : "ies"} (an older export or backup)`);
  }
  return out;
}

/** Plain journal entries inside an ORBIT JSON export/backup (local.life.journal and journal rows in tables.memories). */
export function plainJournalIn(text: string): number {
  let j: { local?: { life?: { journal?: Record<string, unknown> } }; tables?: { memories?: Row[] }; journal?: Record<string, unknown> };
  try { j = JSON.parse(text); } catch { return 0; }
  const life = j?.local?.life?.journal ?? j?.journal ?? {};
  const days = Object.values(life && typeof life === "object" ? life : {}).filter((v) => typeof v === "string" && v && !isSealed(v)).length;
  const rows = (Array.isArray(j?.tables?.memories) ? j.tables.memories : []).filter((r) => r?.kind === "journal" && !(isSealed(r.title) && isSealed(r.content))).length;
  return days + rows;
}
