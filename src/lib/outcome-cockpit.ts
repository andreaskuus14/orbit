// ORBIT Outcome Engine — durable local JSON store (<ORBIT data dir>/outcomes.json).
// Pure DAG/verification/Rule-6 logic lives in outcome-cockpit-pure.ts.
import { randomUUID } from "node:crypto";
import path from "node:path";
import { orbitDataDir } from "./data-dir";
import { readStore, writeStore } from "./safe-file";
import {
  MAX_OUTCOMES_PER_USER,
  createOutcomeFromTemplate,
  decideApproval,
  parseOutcomeStore,
  recordCheckResult,
  retryFixStep,
  startReadySteps,
  updateStepStatus,
  type OutcomeProject,
  type OutcomeStore,
  type OutcomeTemplateId,
  type StepStatus,
} from "./outcome-cockpit-pure";
import { endDebate, newPlanDebate } from "./outcome-debate-pure";

/** ORBIT_OUTCOME_DEBATE=0 turns the critic-vs-planner plan review off for new outcomes. */
const DEBATE_ON = process.env.ORBIT_OUTCOME_DEBATE !== "0";

const file = () => path.join(orbitDataDir(), "outcomes.json");
const g = globalThis as unknown as { __orbitOutcomesLock?: Promise<unknown> };

const load = async (): Promise<OutcomeStore> => parseOutcomeStore(await readStore(file()));

function update<T>(fn: (s: OutcomeStore) => T): Promise<T> {
  const p = (g.__orbitOutcomesLock ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await load();
    const out = fn(s);
    await writeStore(file(), JSON.stringify(s));
    return out;
  });
  g.__orbitOutcomesLock = p;
  return p;
}

export async function listOutcomes(userId: string): Promise<OutcomeProject[]> {
  try {
    return (await load()).users[userId]?.items ?? [];
  } catch {
    return [];
  }
}

export async function createOutcome(
  userId: string,
  input: { template: OutcomeTemplateId; title?: string; brief?: string },
): Promise<{ project?: OutcomeProject; error?: string }> {
  return update((s) => {
    const u = (s.users[userId] ??= { items: [] });
    if (u.items.length >= MAX_OUTCOMES_PER_USER) {
      return { error: `At most ${MAX_OUTCOMES_PER_USER} outcome projects: archive or delete one first.` };
    }
    const created = createOutcomeFromTemplate(input.template, {
      id: randomUUID(),
      title: input.title,
      brief: input.brief,
      now: new Date().toISOString(),
    });
    if (typeof created === "string") return { error: created };
    const project: OutcomeProject = DEBATE_ON ? { ...created, debate: newPlanDebate() } : created;
    u.items.unshift(project);
    return { project };
  });
}

export async function mutateOutcome(
  userId: string,
  id: string,
  fn: (p: OutcomeProject, now: string) => OutcomeProject | string,
): Promise<{ project?: OutcomeProject; error?: string }> {
  return update((s) => {
    const items = s.users[userId]?.items;
    const i = items?.findIndex((x) => x.id === id) ?? -1;
    if (!items || i < 0) return { error: "Outcome project not found" };
    const next = fn(items[i], new Date().toISOString());
    if (typeof next === "string") return { error: next };
    items[i] = next;
    return { project: next };
  });
}

export const runParallelOutcomeSteps = (userId: string, id: string) =>
  mutateOutcome(userId, id, (p, now) => startReadySteps(p, now));

export const setOutcomeStep = (
  userId: string,
  id: string,
  stepId: string,
  status: Exclude<StepStatus, "waiting_approval">,
  opts?: { reused?: boolean; note?: string },
) => mutateOutcome(userId, id, (p, now) => updateStepStatus(p, stepId, status, { ...opts, now }));

export const setOutcomeCheck = (userId: string, id: string, checkId: string, pass: boolean, proof: string) =>
  mutateOutcome(userId, id, (p, now) => recordCheckResult(p, checkId, pass, proof, now));

export const retryOutcomeStep = (userId: string, id: string, stepId: string) =>
  mutateOutcome(userId, id, (p, now) => retryFixStep(p, stepId, now));

export const decideOutcomeApproval = (userId: string, id: string, approvalId: string, decision: "approved" | "rejected") =>
  mutateOutcome(userId, id, (p, now) => decideApproval(p, approvalId, decision, now));

/** Owner chose to run the plan without the critic review. */
export const skipPlanReview = (userId: string, id: string) =>
  mutateOutcome(userId, id, (p, now) => (p.debate?.status === "pending" ? endDebate(p, "skipped", "Skipped by you; the plan runs as written.", now) : "The plan review is not pending."));

export async function deleteOutcome(userId: string, id: string): Promise<boolean> {
  return update((s) => {
    const u = s.users[userId];
    if (!u) return false;
    const before = u.items.length;
    u.items = u.items.filter((x) => x.id !== id);
    return u.items.length < before;
  });
}
