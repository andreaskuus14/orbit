// Tracked pitch links, IO side (rules: pitch-links-pure.ts). <ORBIT data dir>/pitch-links.json. Creating a link sends nothing;
// the owner copies /p/<token> and sends it himself. Views store time, seconds on page, a coarse browser and at most a /24.
// Public calls verify the token on a read-only load first: a bad token never writes; rate buckets are per verified link.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import { getPreviewKey } from "./workspace";
import type { Contract } from "./contracts-pure";
import { listContracts } from "./contracts";
import { TEMPLATES, contractText } from "./contracts-pure";
import { pushNotify } from "./remote-push";
import { MAX_LINKS, MAX_VIEWS, OPEN_LIMIT, beaconSecs, coarseUa, expiryFor, ipPrefix, isPreviewUa, linkToken, parseToken, pitchKey, rateOk, tokenState, viewSummary, type PitchLink } from "./pitch-links-pure";

export class LinkError extends Error { status: number; constructor(m: string, status = 400) { super(m); this.status = status; } }
const FILE = () => path.join(orbitDataDir(), "pitch-links.json");
const g = globalThis as unknown as { __orbitLinks?: Promise<unknown>; __orbitLinkRate?: Map<string, { start: number; n: number }> };
const rate = (g.__orbitLinkRate ??= new Map());
const key = async () => pitchKey(await getPreviewKey());

async function load(): Promise<PitchLink[]> {
  try { const j = JSON.parse(await readFile(FILE(), "utf8")); if (!Array.isArray(j?.links)) throw new Error("pitch-links.json is unreadable"); return j.links; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
}
function update<T>(fn: (list: PitchLink[]) => T | Promise<T>): Promise<T> {
  const p = (g.__orbitLinks ?? Promise.resolve()).catch(() => {}).then(async () => {
    const list = await load(), out = await fn(list);
    await mkdir(path.dirname(FILE()), { recursive: true });
    await writeFile(FILE() + ".tmp", JSON.stringify({ links: list }));
    await rename(FILE() + ".tmp", FILE());
    return out;
  });
  g.__orbitLinks = p;
  return p;
}

const owned = async (l: PitchLink) => ({ id: l.id, contractId: l.contractId, n: l.n, at: l.at, exp: l.exp, notify: l.notify, revoked: l.revoked ?? null,
  path: `/p/${linkToken(await key(), l)}`, ...viewSummary(l), recent: l.views.slice(-10).reverse() });

export async function listLinks(contractId: unknown) {
  const list = (await load()).filter((l) => l.contractId === contractId);
  const cancelled = (await listContracts()).find((c) => c.id === contractId)?.status === "cancelled";
  return Promise.all(list.map(async (l) => ({ ...(await owned(l)), ...(cancelled && !l.revoked && { revoked: "contract cancelled" }) })));
}

/** His "Share link" click: pins the contract's current version. Sends nothing. */
export async function createLink(contractId: unknown, days: unknown, notify: unknown) {
  const c = (await listContracts()).find((x) => x.id === contractId);
  if (!c) throw new LinkError("Contract not found", 404);
  if (c.status === "cancelled") throw new LinkError("This contract is cancelled", 409);
  const l: PitchLink = { id: randomBytes(9).toString("base64url"), contractId: c.id, n: c.versions.at(-1)!.n, title: c.title, nonce: randomBytes(16).toString("base64url"),
    at: new Date().toISOString(), exp: expiryFor(days, Date.now() / 1000), notify: notify === true, views: [] };
  await update((list) => { if (list.filter((x) => !x.revoked).length >= MAX_LINKS) throw new LinkError("Too many links: revoke old ones first", 409); list.push(l); });
  return owned(l);
}

export async function revokeLink(id: unknown) {
  const l = await update((list) => { const l = list.find((x) => x.id === id); if (!l) throw new LinkError("Link not found", 404); l.revoked ??= new Date().toISOString(); return l; });
  return owned(l);
}

type Doc = { title: string; text: string; viewId: string };
/** The link if this token is valid right now and its contract isn't cancelled (read-only: no write for a bad token). */
async function verified(token: string): Promise<{ l: PitchLink; c: Contract } | { state: string }> {
  const id = parseToken(token)?.id, l = (await load()).find((x) => x.id === id);
  const state = tokenState(await key(), token, l, Date.now() / 1000);
  if (state !== "ok" || !l) return { state };
  const c = (await listContracts()).find((x) => x.id === l.contractId);
  if (!c || c.status === "cancelled") return { state: "revoked" }; // a cancelled contract closes its links
  return { l, c };
}

/** A public open: the document to render and a view id ("" = not logged), or the reason it isn't shown. HEAD and link previews aren't views. */
export async function openLink(token: string, ua: string | null, fwd: string | null, head = false): Promise<Doc | { state: string }> {
  const r = await verified(token);
  if ("state" in r) return r;
  if (!rateOk(rate, `open|${r.l.id}`, Date.now(), OPEN_LIMIT)) return { state: "busy" };
  const v = r.c.versions.find((x) => x.n === r.l.n);
  if (!v) return { state: "bad" };
  const doc = { title: r.c.title, text: contractText(TEMPLATES[r.c.template], r.c.title, v.fields, v.clauses), viewId: "" };
  if (head || isPreviewUa(ua)) return doc;
  const view = { id: randomBytes(9).toString("base64url"), at: new Date().toISOString(), secs: 0, ua: coarseUa(ua), ip: ipPrefix(fwd) };
  const first = await update((list) => { const l = list.find((x) => x.id === r.l.id); if (!l) return false; l.views = [...l.views, view].slice(-MAX_VIEWS); return l.views.length === 1 && l.notify; });
  if (first) pushNotify("view"); // fixed label only: never who, what or where
  return { ...doc, viewId: view.id };
}

/** Seconds-on-page beat. false = refused (bad link, rate limit, unknown view). Writes only when the seconds actually grew. */
export async function beacon(token: string, viewId: unknown, secs: unknown): Promise<boolean> {
  if (typeof viewId !== "string") return false;
  const r = await verified(token);
  if ("state" in r || !rateOk(rate, `beat|${r.l.id}`, Date.now())) return false;
  const v0 = r.l.views.find((x) => x.id === viewId);
  if (!v0) return false;
  if (beaconSecs(v0.secs, secs, Date.parse(v0.at), Date.now()) === v0.secs) return true;
  return update((list) => {
    const v = list.find((x) => x.id === r.l.id && !x.revoked)?.views.find((x) => x.id === viewId);
    if (!v) return false;
    v.secs = beaconSecs(v.secs, secs, Date.parse(v.at), Date.now());
    return true;
  });
}
