// Tracked pitch links, IO side (rules: pitch-links-pure.ts). <ORBIT data dir>/pitch-links.json. Creating a link sends nothing;
// the owner copies /p/<token> and sends it himself. Views store time, seconds on page, a coarse browser and at most a /24.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import { getPreviewKey } from "./workspace";
import { listContracts } from "./contracts";
import { TEMPLATES, contractText } from "./contracts-pure";
import { pushNotify } from "./remote-push";
import { MAX_LINKS, MAX_VIEWS, beaconSecs, coarseUa, expiryFor, ipPrefix, linkToken, parseToken, rateOk, tokenState, viewSummary, type PitchLink } from "./pitch-links-pure";

export class LinkError extends Error { status: number; constructor(m: string, status = 400) { super(m); this.status = status; } }
const FILE = () => path.join(orbitDataDir(), "pitch-links.json");
const g = globalThis as unknown as { __orbitLinks?: Promise<unknown>; __orbitLinkRate?: Map<string, { start: number; n: number }> };
const rate = (g.__orbitLinkRate ??= new Map());

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
  path: `/p/${linkToken(await getPreviewKey(), l)}`, ...viewSummary(l), recent: l.views.slice(-10).reverse() });

export async function listLinks(contractId: unknown) {
  const list = (await load()).filter((l) => l.contractId === contractId);
  return Promise.all(list.map(owned));
}

/** His "Share link" click: pins the contract's current version. Sends nothing. */
export async function createLink(contractId: unknown, days: unknown, notify: unknown) {
  const c = (await listContracts()).find((x) => x.id === contractId);
  if (!c) throw new LinkError("Contract not found", 404);
  const l: PitchLink = { id: randomBytes(9).toString("base64url"), contractId: c.id, n: c.versions.at(-1)!.n, title: c.title, nonce: randomBytes(16).toString("base64url"),
    at: new Date().toISOString(), exp: expiryFor(days, Date.now() / 1000), notify: notify === true, views: [] };
  await update((list) => { if (list.filter((x) => !x.revoked).length >= MAX_LINKS) throw new LinkError("Too many links: revoke old ones first", 409); list.push(l); });
  return owned(l);
}

export async function revokeLink(id: unknown) {
  const l = await update((list) => { const l = list.find((x) => x.id === id); if (!l) throw new LinkError("Link not found", 404); l.revoked ??= new Date().toISOString(); return l; });
  return owned(l);
}

/** A public open: the document to render and a view id, or the reason it isn't shown. */
export async function openLink(token: string, ua: string | null, fwd: string | null): Promise<{ title: string; text: string; viewId: string } | { state: string }> {
  const id = parseToken(token)?.id, key = await getPreviewKey();
  const l0 = (await load()).find((x) => x.id === id), state = tokenState(key, token, l0, Date.now() / 1000);
  if (state !== "ok" || !l0) return { state };
  const c = (await listContracts()).find((x) => x.id === l0.contractId), v = c?.versions.find((x) => x.n === l0.n);
  if (!c || !v) return { state: "bad" };
  const view = { id: randomBytes(9).toString("base64url"), at: new Date().toISOString(), secs: 0, ua: coarseUa(ua), ip: ipPrefix(fwd) };
  const first = await update((list) => { const l = list.find((x) => x.id === l0.id); if (!l) return false; l.views = [...l.views, view].slice(-MAX_VIEWS); return l.views.length === 1 && l.notify; });
  if (first) pushNotify("view"); // fixed label only: never who, what or where
  return { title: c.title, text: contractText(TEMPLATES[c.template], c.title, v.fields, v.clauses), viewId: view.id };
}

/** Seconds-on-page beat. false = refused (bad link, rate limit). */
export async function beacon(token: string, viewId: unknown, secs: unknown, fwd: string | null): Promise<boolean> {
  const p = parseToken(token);
  if (!p || typeof viewId !== "string" || !rateOk(rate, `${p.id}|${ipPrefix(fwd)}`, Date.now())) return false;
  const key = await getPreviewKey();
  return update((list) => {
    const l = list.find((x) => x.id === p.id);
    if (tokenState(key, token, l, Date.now() / 1000) !== "ok") return false;
    const v = l!.views.find((x) => x.id === viewId);
    if (!v) return false;
    v.secs = beaconSecs(v.secs, secs, Date.parse(v.at), Date.now());
    return true;
  });
}
