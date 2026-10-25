// "ORBIT's morning brief", server side: gathers from the morning briefing (getMorning), phone-remote approvals, BUSINESS replies and
// kept lessons, composes with brief-pure, and polishes the words with at most ONE fast-model call per local day (deterministic
// fallback). State in <data dir>/brief.json: per user the polish of the day, the LIFE opt-in and snoozes (ids only, no content).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir";
import { askClaude, FAST_MODEL, recordUsage } from "./claude";
import { localDay } from "./morning-pure";
import { POLISH_SYSTEM, briefDecisions, briefOpener, cleanPolish, composeBrief, polishPrompt, type Brief } from "./brief-pure";

type UserBrief = { life?: boolean; snoozed?: Record<string, string>; polish?: { day: string; base?: string; text?: string } }; // snoozed: id → until day
type Store = { users: Record<string, UserBrief> };
const file = () => path.join(orbitDataDir(), "brief.json");
const load = async (): Promise<Store> => { try { const j = JSON.parse(await readFile(file(), "utf8")); return j?.users && typeof j.users === "object" ? j : { users: {} }; } catch { return { users: {} }; } };
let saving: Promise<unknown> = Promise.resolve();
function update(userId: string, fn: (u: UserBrief) => UserBrief): Promise<UserBrief> {
  const p = saving.catch(() => {}).then(async () => {
    const s = await load();
    const u = (s.users[userId] = fn(s.users[userId] ?? {}));
    await mkdir(path.dirname(file()), { recursive: true });
    await writeFile(file() + ".tmp", JSON.stringify(s));
    await rename(file() + ".tmp", file());
    return u;
  });
  saving = p;
  return p;
}

const within = <T>(p: Promise<T>, ms = 4000) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
const DAY = 86_400_000;

/** BUSINESS prospects that moved to "replied" in the last day (names only). */
async function replies(sb: SupabaseClient, now: number) {
  const { data, error } = await sb.from("prospects").select("id, name").eq("stage", "replied").gte("updated_at", new Date(now - DAY).toISOString()).limit(5);
  if (error) throw error;
  return (data ?? []) as { id: string; name: string }[];
}

/** The deterministic brief for now (no AI call). */
export async function composeToday(sb: SupabaseClient, userId: string, now = Date.now()): Promise<Brief> {
  const day = localDay(new Date(now)), hour = new Date(now).getHours();
  const [u, m, rem, rep, les, dl, hl, ds] = await Promise.all([
    load().then((s) => s.users[userId] ?? {}),
    import("./morning").then((x) => x.getMorning(sb, userId, now)),
    within(import("./remote").then((x) => x.pendingApprovals(sb))).catch(() => []),
    within(replies(sb, now)).catch(() => []),
    within(import("./lessons").then((x) => x.lessonsView(userId))).then((v) => v.kept, () => []),
    within(import("./deals").then((x) => x.freshDeals(now, DAY))).catch(() => null),
    within(Promise.all([import("./health"), import("./health-pure")]).then(async ([h, p]) => p.briefHealth(await h.healthIssues(), now))).catch(() => null),
    within(import("./dev-session").then((x) => x.yesterdaySession(userId, now))).catch(() => null),
  ]);
  const deal = dl?.latest && dl.ids.length ? { id: dl.ids[dl.ids.length - 1], ...dl.latest } : undefined;
  const lesson = les.length ? les[Math.floor(now / DAY) % les.length] : undefined; // a different kept lesson each day
  return composeBrief({
    day, hour, life: !!u.life, morning: m,
    decisions: briefDecisions(m.night?.approvals ?? [], m.work?.items ?? [], rem),
    replies: rep, deal, ...(hl && { health: hl }), ...(ds && { devSession: ds }), lesson: lesson && { id: lesson.id, text: lesson.text },
    snoozed: Object.entries(u.snoozed ?? {}).filter(([, until]) => until > day).map(([id]) => id),
  });
}

/** The brief with today's polished words when they still match (one model call a day at most; any failure keeps the plain words). */
export async function getBrief(sb: SupabaseClient, userId: string, now = Date.now()): Promise<Brief & { life: boolean }> {
  const b = await composeToday(sb, userId, now);
  const u = (await load()).users[userId] ?? {};
  const p = u.polish;
  if (p?.day === b.day) return { ...b, life: !!u.life, ...(p.base === b.spoken && p.text && { spoken: p.text, polished: true }) };
  if (!b.items.length) return { ...b, life: !!u.life };
  await update(userId, (x) => ({ ...x, polish: { day: b.day } })); // the day's one try is used before the call: a crash can't make it two
  let text = b.spoken;
  try {
    const r = await askClaude(polishPrompt(b.spoken), POLISH_SYSTEM, { lane: "foreground", model: FAST_MODEL, timeoutMs: 12_000, purpose: "brief.polish" });
    void recordUsage(sb, userId, "brief.polish", r, FAST_MODEL);
    text = cleanPolish(r.text, b.spoken);
  } catch (e) { console.error("[brief] polish:", e instanceof Error ? e.message : e); }
  await update(userId, (x) => ({ ...x, polish: { day: b.day, base: b.spoken, text } })).catch(() => {});
  return { ...b, life: !!u.life, spoken: text, polished: text !== b.spoken };
}

/** Hide one item until tomorrow. */
export const snoozeItem = (userId: string, id: string, now = Date.now()) => update(userId, (u) => {
  const today = localDay(new Date(now));
  const kept = Object.fromEntries(Object.entries(u.snoozed ?? {}).filter(([, until]) => until > today)); // expired ones drop out
  return { ...u, snoozed: { ...kept, [id.slice(0, 128)]: localDay(new Date(now + DAY)) } };
});

/** LIFE opt-in: calendar titles and reminder text may be said aloud (off by default). */
export const setBriefLife = (userId: string, life: boolean) => update(userId, (u) => ({ ...u, life }));

/** The phone's morning-call opener from the same composer (no model call here; the call's own personaliser may add one). */
export async function morningOpener(sb: SupabaseClient, userId: string, hour: number): Promise<string | null> {
  const b = await within(composeToday(sb, userId), 8000);
  return b.items.length ? briefOpener(b, hour) : null;
}
