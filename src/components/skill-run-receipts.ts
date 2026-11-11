"use client";

import { useSyncExternalStore } from "react";

export type SkillLaunch = { skillId: string; runId: string };
export type SkillReceipt = SkillLaunch & {
  state: "queued" | "started" | "completed" | "failed";
  chatId?: string;
  taskId?: string;
};

export const CORE_OPEN_SKILL_CHAT = "orbit:core-open-skill-chat";
const empty: Readonly<Record<string, SkillReceipt>> = {};
let receipts = empty;
const listeners = new Set<() => void>();

function save(receipt: SkillReceipt) {
  receipts = { ...receipts, [receipt.skillId]: receipt };
  listeners.forEach((notify) => notify());
}

export function queueSkillRun(skillId: string): SkillLaunch {
  const launch = { skillId, runId: crypto.randomUUID() };
  save({ ...launch, state: "queued" });
  return launch;
}

export function updateSkillRun(launch: SkillLaunch, patch: Partial<Pick<SkillReceipt, "state" | "chatId" | "taskId">>) {
  const current = receipts[launch.skillId];
  if (current?.runId === launch.runId) save({ ...current, ...patch });
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
};

export function useSkillReceipts() {
  return useSyncExternalStore(subscribe, () => receipts, () => empty);
}
