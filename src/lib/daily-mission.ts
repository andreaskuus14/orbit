// Daily mission targets he picked (rules: daily-mission-pure.ts): <ORBIT data dir>/daily-mission.json, and today's counts for the
// targets beyond the original three, each read from its own record store. A count that can't be read stays undefined ("no data").
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import { followupsSent, parsePicks, type MissionIn, type Target } from "./daily-mission-pure";

const file = () => path.join(orbitDataDir(), "daily-mission.json");

/** His picks; [] (= the default three) when none are saved or the file is unreadable. */
export async function loadPicks(): Promise<Target[]> {
  try { const p = parsePicks(JSON.parse(await readFile(file(), "utf8")).targets); return typeof p === "string" ? [] : p; }
  catch { return []; }
}

export async function savePicks(v: unknown): Promise<Target[] | string> {
  const p = parsePicks(v);
  if (typeof p === "string") return p;
  await mkdir(path.dirname(file()), { recursive: true });
  await writeFile(file() + ".tmp", JSON.stringify({ targets: p }));
  await rename(file() + ".tmp", file());
  return p;
}

const soft = <T>(p: Promise<T>) => p.catch((e) => { console.error("[daily-mission]", e instanceof Error ? e.message : e); return undefined; });

/** Today's counts for the picked extra targets (local day). The original three are counted in morning.ts. */
export async function extraCounts(userId: string, picks: Target[], now = Date.now()): Promise<MissionIn> {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  const from = d.getTime(), want = new Set(picks.map((p) => p.id));
  const [followupsToday, invoicesToday, devSessionsToday, studyToday] = await Promise.all([
    want.has("followups") ? soft(import("./prospect-crm").then((c) => c.loadCrm()).then((s) => followupsSent(Object.values(s).map((c) => c.events ?? []), from))) : undefined,
    want.has("invoices") ? soft(import("./invoices").then((x) => x.allInvoices()).then((l) => l.filter((i) => i.sentAt && Date.parse(i.sentAt) >= from).length)) : undefined,
    want.has("devsession") ? soft(import("./dev-session").then((x) => x.devSessionsSince(userId, from))) : undefined,
    want.has("study") ? soft(import("./study").then((x) => x.reviewedToday(userId, now))) : undefined,
  ]);
  return { followupsToday, invoicesToday, devSessionsToday, studyToday };
}
