import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { FAST_MODEL, SMART_MODEL, askClaude } from "./claude";
import { orbitDataDir } from "./data-dir";
import { getJson } from "./reach/net";
import { stopAllOn } from "./stop-all";
import { PAUSED_MSG } from "./stop-all-pure";
import { usageHoldFor } from "./usage-meter";
import { ANGLE_SYSTEM, REPLY_SYSTEM, anglePrompt, chatwootReplyRequest, replyPrompt, type ChatItem, type ChatMsg, applyDraft, claimSend, appStoreFeed, appStoreRef, cluster, parseAppStore, parseReddit, redditSearch, type Complaint, type Theme } from "./complaints-pure";

// BUSINESS "What users hate": <ORBIT data dir>/business/complaints.json (one report per niche). Read-only: public App Store review RSS (for the
// niche's rival links that are App Store pages) and Reddit search JSON, via reach/net (safeFetch + polite gaps). No logins, no posting.
// Trustpilot/G2 are not read: they answer bots with a check page. Logic: complaints-pure.ts.
export type Report = { at: string; themes: Theme[]; notes: string[]; sample: number; angle?: string };

const FILE = () => path.join(orbitDataDir(), "business", "complaints.json");
const g = globalThis as unknown as { __orbitComplaintsWrite?: Promise<unknown> };
const load = async (): Promise<Record<string, Report>> => {
  try { const j = JSON.parse(await readFile(FILE(), "utf8")); return j && typeof j === "object" && !Array.isArray(j) ? j : {}; } catch { return {}; }
};
function save<T>(fn: (s: Record<string, Report>) => T): Promise<T> {
  const p = (g.__orbitComplaintsWrite ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await load(), out = fn(s);
    await mkdir(path.dirname(FILE()), { recursive: true });
    await writeFile(FILE() + ".tmp", JSON.stringify(s));
    await rename(FILE() + ".tmp", FILE());
    return out;
  });
  g.__orbitComplaintsWrite = p;
  return p;
}

export async function complaintsFor(id: string): Promise<Report | null> { return (await load())[id] ?? null; }

/** Read the public sources for one niche now (a few small fetches) and store the clustered themes. */
export async function mineComplaints(id: string, signal?: AbortSignal): Promise<Report> {
  const niche = (await (await import("./niche")).nicheBoard()).niches.find((n) => n.id === id);
  if (!niche) throw new Error("Niche not found");
  const rivals = (await (await import("./rivals")).rivalsBoard()).urls[id] ?? [];
  const jobs: { name: string; run: () => Promise<Complaint[]> }[] = [{ name: "Reddit", run: async () => parseReddit(await getJson(redditSearch(`${niche.title} problems OR hate OR terrible`))) }];
  for (const u of rivals) {
    const a = appStoreRef(u);
    if (a) jobs.push({ name: `App Store ${a.id}`, run: async () => parseAppStore(await getJson(appStoreFeed(a.cc, a.id)), a.cc, a.id) });
  }
  const all: Complaint[] = [], notes: string[] = [];
  for (const j of jobs) {
    if (signal?.aborted || stopAllOn()) throw new Error("Stopped");
    try { all.push(...(await j.run())); } catch (e) { notes.push(`${j.name}: ${(e instanceof Error ? e.message : "failed").slice(0, 120)}`); }
  }
  if (!rivals.some((u) => appStoreRef(u))) notes.push("No App Store link among the rivals: add one to read its reviews.");
  const themes = cluster(all);
  const r: Report = { at: new Date().toISOString(), themes, notes, sample: all.length };
  await save((s) => { s[id] = r; });
  return r;
}

/** CORE turns the stored themes into fixes + a selling angle (one model call on the owner's click; the quotes are fenced as untrusted). */
export async function writeAngle(id: string, signal?: AbortSignal): Promise<string> {
  const held = stopAllOn() ? PAUSED_MSG : usageHoldFor("foreground");
  if (held) throw new Error(held);
  const r = await complaintsFor(id), niche = (await (await import("./niche")).nicheBoard()).niches.find((n) => n.id === id);
  if (!r?.themes.length || !niche) throw new Error("Read the complaints first");
  const out = await askClaude(anglePrompt(niche.title, r.themes), ANGLE_SYSTEM, { lane: "foreground", purpose: "business.complaints", model: SMART_MODEL, timeoutMs: 120_000, signal });
  const angle = out.text.trim().slice(0, 1500);
  await save((s) => { if (s[id]) s[id].angle = angle; });
  return angle;
}

// --- Customer chat: <ORBIT data dir>/business/chatwoot.json. The webhook stores + drafts; only the owner's Send click (complaints route) posts back.
const CHAT_FILE = () => path.join(orbitDataDir(), "business", "chatwoot.json");
const cg = globalThis as unknown as { __orbitChatWrite?: Promise<unknown> };
const loadChats = async (): Promise<ChatItem[]> => {
  try { const j = JSON.parse(await readFile(CHAT_FILE(), "utf8")); return Array.isArray(j) ? j : []; } catch { return []; }
};
function saveChats<T>(fn: (s: ChatItem[]) => T): Promise<T> {
  const p = (cg.__orbitChatWrite ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await loadChats(), out = fn(s);
    s.splice(0, Math.max(0, s.length - 200)); // shortcut: keeps the newest 200 chats, add paging if the shop gets busy
    await mkdir(path.dirname(CHAT_FILE()), { recursive: true });
    await writeFile(CHAT_FILE() + ".tmp", JSON.stringify(s));
    await rename(CHAT_FILE() + ".tmp", CHAT_FILE());
    return out;
  });
  cg.__orbitChatWrite = p;
  return p;
}

export const listChats = loadChats;

/** Store one incoming chat message (dedupe on id) and draft a reply. Never sends. A failed or held draft is marked so the UI stops waiting. */
export async function addChat(m: ChatMsg): Promise<void> {
  const fresh = await saveChats((s) => !s.some((c) => c.id === m.id) && !!s.push({ ...m }));
  if (!fresh) return;
  const fail = (why: string) => saveChats((s) => { const c = s.find((x) => x.id === m.id); if (c && c.draft === undefined) c.draftFailed = why.slice(0, 200); });
  const held = stopAllOn() ? PAUSED_MSG : usageHoldFor("background");
  if (held) { await fail(held); return; }
  try {
    const out = await askClaude(replyPrompt(m), REPLY_SYSTEM, { lane: "background", purpose: "business.chat", model: FAST_MODEL, timeoutMs: 90_000 });
    const draft = out.text.trim().slice(0, 2000);
    await saveChats((s) => { const c = s.find((x) => x.id === m.id); if (c) applyDraft(c, draft); });
  } catch (e) { await fail(e instanceof Error ? e.message : "Draft failed"); throw e; }
}

/** Owner's Send click only: post the (possibly edited) reply into the Chatwoot conversation. */
export async function sendChat(id: string, text: string, doFetch: typeof fetch = fetch): Promise<ChatItem> {
  const base = process.env.CHATWOOT_URL, token = process.env.CHATWOOT_API_TOKEN;
  if (!base || !token) throw new Error("Set CHATWOOT_URL and CHATWOOT_API_TOKEN");
  const content = text.trim();
  const c = await saveChats((s) => claimSend(s.find((x) => x.id === id), content, new Date().toISOString())); // check+set under the lock: no double send
  try {
    const { url, init } = chatwootReplyRequest(base, token, c, content);
    const res = await doFetch(url, init);
    if (!res.ok) throw new Error(`Chatwoot answered ${res.status}`);
    return c;
  } catch (e) {
    await saveChats((s) => { const x = s.find((y) => y.id === id); if (x && x.sentAt === c.sentAt) delete x.sentAt; });
    throw e;
  }
}
