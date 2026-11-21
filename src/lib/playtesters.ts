import path from "node:path";
import { readStore, writeStore } from "./safe-file.ts";
import { orbitDataDir } from "./data-dir";
import { SQUAD, hashText, runSquad, stages, type Live, type Report } from "./playtesters-pure";

// AI playtesters runner (rules: playtesters-pure.ts). Night slot "playtesters" and /api/playtesters.
// Off until the owner switches it on (allowed). Plays only when the Studio bridge is set up and Studio is open; never edits the place
// during play. Code checks read his own Rojo project. A fix is written only on his Approve click, through rojo.ts writeScript
// (Selene check, git snapshot, one undoable "ORBIT edit" commit). Nothing is published.
// State: <ORBIT data dir>/playtesters.json, per user: { allowed, report }.

type User = { allowed?: boolean; report?: Report };
type Store = Record<string, User>;
const file = () => path.join(orbitDataDir(), "playtesters.json");
const g = globalThis as unknown as { __orbitPlaytesters?: { live: Live; write: Promise<unknown> } };
const S = (g.__orbitPlaytesters ??= { live: { running: false, step: 0, now: "", startedAt: null }, write: Promise.resolve() });

const load = async (): Promise<Store> => { const t = await readStore(file()), j = t ? JSON.parse(t) : null; return j && typeof j === "object" ? j : {}; };
function update(fn: (s: Store) => void): Promise<void> {
  const p = S.write.catch(() => {}).then(async () => { const s = await load(); fn(s); await writeStore(file(), JSON.stringify(s)); });
  S.write = p;
  return p;
}

/** The report without the big before/after file texts (the UI gets the diff lines through proposalDiff on the server). */
export async function playtestView(userId: string) {
  const u = (await load())[userId] ?? {};
  const { proposalDiff } = await import("./playtesters-pure");
  const report = u.report ? { ...u.report, heatSvg: undefined, proposals: u.report.proposals.map(({ before, after, ...p }) => ({ ...p, diff: proposalDiff({ before, after }) })) } : null;
  return { allowed: !!u.allowed, live: S.live, report, hasHeatmap: !!u.report?.heatSvg, squad: SQUAD.map(({ id, name, type }) => ({ id, name, type })) };
}
export const heatmap = async (userId: string) => (await load())[userId]?.report?.heatSvg ?? null;
export const setAllowed = (userId: string, on: boolean) => update((s) => { (s[userId] ??= {}).allowed = on; });
/** Night: allowed, not running and no report with real Studio runs in the last 20 hours (a night with Studio closed tries again next night). */
export const playtestersDue = async (userId: string, now = Date.now()) => {
  const u = (await load())[userId];
  return !!u?.allowed && !S.live.running && !(u.report?.runs.length && now - Date.parse(u.report.at) < 20 * 3_600_000);
};

export class PlaytestBusyError extends Error {}
export class NotAllowedError extends Error {}

/** One squad run: six look-only Studio playtests (when Studio is open), the code check and the report. */
export async function runPlaytesters(userId: string, signal?: AbortSignal): Promise<Report> {
  if (!(await load())[userId]?.allowed) throw new NotAllowedError("AI playtesters are off. Switch them on in GAME DEV → Test → AI testers first.");
  if (S.live.running) throw new PlaytestBusyError("The AI playtesters are already playing.");
  S.live = { running: true, step: 0, now: "Checking Studio", startedAt: new Date().toISOString() };
  try {
    const rbx = await import("./roblox");
    const report = await runSquad({
      status: async () => {
        const cfg = rbx.robloxConfig();
        if (!cfg.configured) return { configured: false, open: false, place: "", notes: "" };
        const st = await rbx.studioStatus();
        return { configured: true, open: st.open, place: st.place ?? "", notes: st.notes ?? "" };
      },
      play: async (goal, extra) => { const r = await rbx.runPlaytest(goal, extra); return { done: r.done, findings: r.findings, consoleErrors: r.consoleErrors, notes: r.notes, text: r.text, inspect: r.inspect }; },
      code: async () => {
        const rojo = await import("./rojo");
        if (!(await rojo.listProjects()).length) return null;
        const ls = await rojo.listScripts();
        const files = [];
        for (const f of ls.files.slice(0, 200)) files.push(await rojo.readScript(ls.name, f).then((x) => ({ file: x.file, text: x.text }), () => null));
        return { project: ls.name, files: files.filter((x): x is { file: string; text: string } => !!x) };
      },
      onStep: (step, now) => { S.live = { ...S.live, step, now }; },
      signal, now: () => new Date().toISOString(),
    });
    await update((s) => { (s[userId] ??= {}).report = report; });
    return report;
  } finally { S.live = { running: false, step: stages().length, now: "", startedAt: null }; }
}

/** His Approve click on one fix: only onto exactly the file text it was made from, through Rojo's checked, undoable write. */
export async function decideProposal(userId: string, id: unknown, approve: boolean): Promise<string> {
  const r = (await load())[userId]?.report, p = r?.proposals.find((x) => x.id === id);
  if (!r || !p) throw new Error("That fix is gone. Run the playtesters again.");
  if (p.status !== "pending") throw new Error("That fix was already handled.");
  let note = "Dismissed.";
  if (approve) {
    const rojo = await import("./rojo");
    const now = await rojo.readScript(r.project, p.file);
    if (hashText(now.text) !== p.hash) throw new Error(`${p.file} changed since the playtest. Nothing was written; run the playtesters again for a fresh fix.`);
    const w = await rojo.writeScript(r.project, p.file, p.after);
    note = `Written to ${w.file}${w.syncing ? " (Rojo is syncing it to Studio)" : ""}. Undo is in GAME DEV → Build → Files.`;
  }
  await update((s) => { const q = s[userId]?.report?.proposals.find((x) => x.id === id); if (q) { q.status = approve ? "applied" : "dismissed"; q.note = note; } });
  return note;
}
