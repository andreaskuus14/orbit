import { randomBytes } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { MODEL, askClaude } from "../claude";
import { stopAllOn } from "../stop-all";
import { PAUSED_MSG } from "../stop-all-pure";
import { usageHold } from "../usage-meter";
import { validDraft } from "../higgsfield-pure";
import { readState, saveState, studioRoot } from "./factory";
import { models, queueDraft } from "./story";
import { jsonObject } from "./story-pure";
import { LONGFORM_SYSTEM, LF_MAX, LF_MIN, lengthProblem, longProblem, validPlan, visualDraft, type LongJob, type LongPlan } from "./longform-pure";

// Long-form video studio (roadmap 3): topic → Claude's 8-12 minute plan, saved as <studio>/longform/<id>.json. Exports are built in the
// browser from longform-pure.ts. Visuals only as Higgsfield drafts in the AI Story queue: priced, then the owner's Approve click there.

const dir = () => path.join(studioRoot(), "longform");
const save = (j: LongJob) => saveState(j.id, path.join(dir(), `${j.id}.json`), j);
export const getLong = (id: string) => (/^[a-z0-9]{6,12}-[a-f0-9]{6}$/.test(id) ? readState<LongJob>(dir(), id, longProblem) : Promise.resolve(null));
const g = globalThis as unknown as { __orbitLongBusy?: boolean };

export async function listLong(): Promise<LongJob[]> {
  await mkdir(dir(), { recursive: true });
  const ids = (await readdir(dir())).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5));
  return (await Promise.all(ids.map(getLong))).filter((j): j is LongJob => !!j).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export const longBusy = () => !!g.__orbitLongBusy;

/** Claude writes the plan (one retry when it doesn't validate or misses 8-12 minutes; a second miss on length is kept with a warning). */
export async function writeLong(topicIn: unknown, minutesIn: unknown, signal?: AbortSignal): Promise<LongJob | string> {
  const topic = typeof topicIn === "string" ? topicIn.replace(/\s+/g, " ").trim() : "";
  if (topic.length < 3 || topic.length > 500) return "topic must be 3-500 characters";
  const minutes = Math.min(LF_MAX, Math.max(LF_MIN, Math.round(Number(minutesIn) || 10)));
  const held = stopAllOn() ? PAUSED_MSG : usageHold();
  if (held) return held;
  if (g.__orbitLongBusy) return "Already writing a long-form plan; wait for it";
  g.__orbitLongBusy = true;
  try {
    const ask = `Topic: ${topic}\nTarget length: ${minutes} minutes (about ${minutes * 150} spoken words in hook + chapters)`;
    let plan: LongPlan | string = "", why = "";
    for (let i = 0; i < 2 && (typeof plan === "string" || why); i++) {
      if (i && stopAllOn()) return PAUSED_MSG;
      const r = await askClaude(i ? `${ask}\n\nYour last reply was rejected: ${why || plan}. Reply with the full JSON only.` : ask, LONGFORM_SYSTEM,
        { lane: "foreground", signal, model: MODEL, purpose: "clips", timeoutMs: 6 * 60_000 });
      plan = validPlan(jsonObject(r.text));
      why = typeof plan === "string" ? "" : lengthProblem(plan);
    }
    if (typeof plan === "string") return `Claude's plan didn't fit: ${plan}`;
    const job: LongJob = { v: 1, id: `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`, createdAt: new Date().toISOString(), topic, minutes, plan, drafts: [],
      ...(why ? { warning: `Runtime is off: ${why}. Trim or extend the script before filming.` } : {}) };
    await save(job);
    return job;
  } finally { g.__orbitLongBusy = false; }
}

/** The owner's "Price it" click on a thumbnail or shot: a Higgsfield draft in AI Story (get_cost only). Approving there is a separate click. */
export async function draftVisual(job: LongJob, what: unknown): Promise<LongJob | string> {
  if (stopAllOn()) return PAUSED_MSG;
  const v = visualDraft(job.plan, what);
  if (typeof v === "string") return v;
  if (job.drafts.some((d) => d.key === v.key)) return "Already priced: approve or delete it in AI Story";
  const d = validDraft(v.input, models());
  if (typeof d === "string") return d;
  const s = await queueDraft(d, "Long-form");
  job.drafts.push({ key: v.key, story: s.id });
  await save(job);
  return job;
}
