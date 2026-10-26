import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import { DEFAULT_PERSONA, applyProposal, cleanPersona, parseStore, personaPrompt, proposalText, reactionProposal, type Persona, type Store, type Surface } from "./persona-pure";

// ORBIT's persona I/O (logic: persona-pure.ts). State: <ORBIT data dir>/persona.json, per user: sliders, voice, one pending proposal.

const file = () => path.join(orbitDataDir(), "persona.json");
const g = globalThis as unknown as { __orbitPersona?: Promise<unknown>; __orbitPersonaLast?: Persona };

async function load(): Promise<Store> {
  const s = parseStore(await readFile(file(), "utf8").catch((e) => { if (e.code === "ENOENT") return ""; throw e; }));
  if (!s) throw new Error("persona.json is unreadable; fix or move it aside (nothing was overwritten).");
  return s;
}
function update<T>(fn: (s: Store) => T): Promise<T> {
  const p = (g.__orbitPersona ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await load();
    const out = fn(s);
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s, null, 1));
    await rename(file() + ".tmp", file());
    return out;
  });
  g.__orbitPersona = p;
  return p;
}
const remember = (p: Persona) => (g.__orbitPersonaLast = p);

/** The owner's persona (defaults on any failure). */
export const getPersona = (userId: string): Promise<Persona> =>
  load().then((s) => remember(s.users[userId]?.persona ?? DEFAULT_PERSONA), () => DEFAULT_PERSONA);
/** Last persona read in this process, for sync callers (call voice, push). shortcut: single-owner ORBIT; per-user if it ever has more. */
export const lastPersona = () => g.__orbitPersonaLast ?? DEFAULT_PERSONA;
/** Owner-less callers (phone push): the single owner's persona, like lessons.keptLessonsText. */
export const ownerPersona = () => load().then((s) => Object.values(s.users)[0]?.persona ?? DEFAULT_PERSONA, () => DEFAULT_PERSONA);
/** The character block for one surface; never throws. */
export const personaContext = (userId: string, surface: Surface) => getPersona(userId).then((p) => personaPrompt(p, surface));

export async function personaView(userId: string) {
  const u = (await load()).users[userId];
  const persona = remember(u?.persona ?? DEFAULT_PERSONA);
  return { persona, proposal: u?.proposal ? { ...u.proposal, text: proposalText(u.proposal, persona) } : null };
}
export const savePersona = (userId: string, body: unknown) =>
  update((s) => { const u = (s.users[userId] ??= { persona: DEFAULT_PERSONA }); u.persona = remember(cleanPersona(body, u.persona)); delete u.proposal; });

/** "Keep" applies the pending proposal, "reject" drops it. Returns why not, or null. */
export const decideProposal = (userId: string, keep: boolean) => update((s) => {
  const u = s.users[userId];
  if (!u?.proposal) return "That suggestion is gone; reload.";
  if (keep) u.persona = remember(applyProposal(u.persona, u.proposal));
  delete u.proposal;
  return null;
});

/** His reply reads as a reaction to ORBIT's style: store one proposal and return it as a chat chip ({id,text}); else null. Never throws. */
export async function captureReaction(userId: string, text: string): Promise<{ id: string; text: string } | null> {
  try {
    if (!reactionProposal(text, await getPersona(userId), Date.now())) return null; // cheap check first: most turns write nothing
    return await update((s) => {
      const u = (s.users[userId] ??= { persona: DEFAULT_PERSONA });
      const pr = reactionProposal(text, u.persona, Date.now());
      if (!pr) return null;
      u.proposal = pr;
      return { id: `persona|${pr.slider}|${pr.to}`, text: proposalText(pr, u.persona) };
    });
  } catch (e) { console.warn("[persona] reaction not saved:", e instanceof Error ? e.message : e); return null; }
}
