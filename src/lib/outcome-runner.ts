// ORBIT Outcome Engine — Live Runner Bridge.
// Dispatches ready, non-approval Outcome Cockpit steps to real ORBIT Missions (src/lib/missions.ts),
// stores real mission runIds on the steps, and reconciles live mission status/receipts back into outcomes.json.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMission, listMissions, reconcile, type MissionView } from "./missions";
import type { MissionDoc } from "./missions-pure";
import { listOutcomes, mutateOutcome } from "./outcome-cockpit";
import {
  applyRunnerSync,
  attachStepRun,
  canDispatchStep,
  isSafeOutcomeText,
  readySteps,
  type OutcomeProject,
  type OutcomeRunnerKind,
  type OutcomeStep,
  type RunnerSyncSnapshot,
} from "./outcome-cockpit-pure";

export const MAX_PARALLEL_DISPATCH = 3;

const KNOWN_AGENTS = new Set([
  "nova", "atlas", "pulse", "echo", "forge", "vector", "sentinel",
  "flow", "qa", "scout", "muse", "plinth", "closer", "prospector", "outreach",
]);

function workerAgentFor(step: OutcomeStep): string {
  const slug = step.agent.trim().toLowerCase();
  if (KNOWN_AGENTS.has(slug)) return slug;
  if (step.planet === "studio") return "muse";
  if (step.planet === "gamedev" || step.kind === "build") return "forge";
  if (step.planet === "business") return "closer";
  if (step.planet === "research" || step.kind === "research") return "atlas";
  if (step.kind === "verify") return "qa";
  return "nova";
}

function buildStepMissionPayload(
  project: OutcomeProject,
  step: OutcomeStep,
  runnerKind: Exclude<OutcomeRunnerKind, "manual">,
) {
  const objective = `[Outcome: ${project.title}] ${step.title}`.slice(0, 295);
  const acceptance = `Concrete proof produced for "${step.title}" (${step.planet}) with zero unverified claims.`.slice(0, 295);
  const worker = workerAgentFor(step);
  const stepPrompt = [
    `Outcome: ${project.title}`,
    `Brief: ${project.brief}`,
    `Step (${step.planet} / ${runnerKind} runner): ${step.title}`,
    "Rules: Do NOT send, publish, upload, spend, log in, or delete anything (Rule 6).",
    "Do NOT read or include private journal/LIFE text or credentials (Rule 6).",
    "Produce concrete proof (paths, diffs, checks, or exact blocker details).",
  ].join("\n").slice(0, 1200);

  const qaPrompt = [
    `Verify the completed work for step "${step.title}" (${step.planet}) in outcome "${project.title}".`,
    "Confirm concrete proof exists and matches the brief. If anything is missing, broken, or unverified, report the exact failure or blocker honestly without faking completion.",
    "No external actions (no send/publish/upload/spend/login/delete).",
  ].join("\n").slice(0, 900);

  return {
    objective,
    acceptance,
    constraints: [
      "Never send, publish, upload, spend, log in, or delete anything automatically (Rule 6).",
      "Never include private journal/LIFE text or credentials (Rule 6).",
      "Return concrete proof or exact failure/blocker details honestly.",
    ],
    steps: [
      { agent: worker, request: stepPrompt },
      { agent: "qa", request: qaPrompt },
    ],
  };
}

function safeSnippet(text: string | undefined, fallback: string): string {
  const s = (text ?? "").replace(/\s+/g, " ").trim().slice(0, 220);
  if (!s) return fallback;
  return isSafeOutcomeText(s) ? s : fallback;
}

function missionToSnapshot(m: MissionView, now: string): RunnerSyncSnapshot {
  const receiptCount = m.doc.receipts.length;
  const lastStep = m.chain?.steps[m.chain.steps.length - 1];
  const lastResult = safeSnippet(lastStep?.result, "");
  const blocker = safeSnippet(m.doc.blocker, "");

  if (m.status === "queued") {
    return { state: "queued", note: safeSnippet(m.label, "Mission queued"), now };
  }
  if (m.status === "running") {
    return { state: "running", note: safeSnippet(`${m.label}: ${m.next}`, "Mission running"), now };
  }
  if (m.status === "completed") {
    const failedCheck = (m.doc.checks ?? []).find((c) => !c.ok);
    const verified = !failedCheck && m.doc.verified !== false;
    const proof = safeSnippet(
      failedCheck
        ? `Check failed: ${failedCheck.what}`
        : `${m.label} (${receiptCount} receipt${receiptCount === 1 ? "" : "s"})${lastResult ? ` — ${lastResult}` : ""}`,
      `${m.label} (${receiptCount} receipts)`,
    );
    return { state: "done", verified, proof, note: proof, now };
  }
  if (m.status === "failed" || m.status === "cancelled") {
    return { state: "failed", note: blocker || safeSnippet(m.label, "Mission failed"), now };
  }
  // waiting-input, waiting-approval, paused
  return { state: "blocked", note: blocker || safeSnippet(m.next || m.label, "Mission waiting for input"), now };
}

async function loadProject(userId: string, projectId: string): Promise<OutcomeProject | null> {
  const list = await listOutcomes(userId);
  return list.find((p) => p.id === projectId) ?? null;
}

/** Dispatch a single ready (or needs_fix/blocked) non-approval step to a real ORBIT Mission. */
export async function dispatchStepRun(
  sb: SupabaseClient,
  userId: string,
  projectId: string,
  stepId: string,
): Promise<{ project?: OutcomeProject; runId?: string; runnerKind?: OutcomeRunnerKind; error?: string }> {
  const project = await loadProject(userId, projectId);
  if (!project) return { error: "Outcome project not found" };
  const step = project.steps.find((s) => s.id === stepId);
  if (!step) return { error: "Step not found" };

  const gate = canDispatchStep(project, step);
  if (!gate.ok) return { error: gate.error };
  if (step.status === "verified") return { error: "Step is already verified." };

  const verifiedIds = new Set(project.steps.filter((s) => s.status === "verified").map((s) => s.id));
  const depsDone = step.dependsOn.every((dep) => verifiedIds.has(dep));
  if (!depsDone && step.status !== "needs_fix" && step.status !== "blocked") {
    return { error: "Step dependencies are not verified yet." };
  }

  const created = await createMission(sb, userId, buildStepMissionPayload(project, step, gate.runnerKind));
  if ("error" in created) return { error: created.error };

  const saved = await mutateOutcome(userId, projectId, (p, now) =>
    attachStepRun(p, stepId, {
      runnerKind: gate.runnerKind,
      runId: created.id,
      runNote: `Dispatched ${gate.runnerKind} mission #${created.id.slice(0, 8)}`,
      now,
    }),
  );
  if (saved.error || !saved.project) return { error: saved.error ?? "Could not save run link" };
  return { project: saved.project, runId: created.id, runnerKind: gate.runnerKind };
}

/** Dispatch all currently ready non-approval steps in parallel (capped at MAX_PARALLEL_DISPATCH). */
export async function dispatchReadyRuns(
  sb: SupabaseClient,
  userId: string,
  projectId: string,
  limit = MAX_PARALLEL_DISPATCH,
): Promise<{
  project?: OutcomeProject;
  dispatched: { stepId: string; runId: string; runnerKind: OutcomeRunnerKind }[];
  errors: string[];
  error?: string;
}> {
  const project = await loadProject(userId, projectId);
  if (!project) return { dispatched: [], errors: [], error: "Outcome project not found" };

  const cap = Math.max(1, Math.min(limit, MAX_PARALLEL_DISPATCH));
  const candidates = readySteps(project).slice(0, cap);
  if (!candidates.length) return { project, dispatched: [], errors: [] };

  const errors: string[] = [];
  const valid: { step: OutcomeStep; runnerKind: Exclude<OutcomeRunnerKind, "manual"> }[] = [];
  for (const step of candidates) {
    const gate = canDispatchStep(project, step);
    if (!gate.ok) errors.push(`${step.id}: ${gate.error}`);
    else valid.push({ step, runnerKind: gate.runnerKind });
  }
  if (!valid.length) return { dispatched: [], errors, error: errors[0] ?? "No dispatchable steps" };

  const results = await Promise.all(
    valid.map(async ({ step, runnerKind }) => {
      const res = await createMission(sb, userId, buildStepMissionPayload(project, step, runnerKind));
      if ("error" in res) return { stepId: step.id, runnerKind, error: res.error };
      return { stepId: step.id, runnerKind, runId: res.id };
    }),
  );

  const dispatched: { stepId: string; runId: string; runnerKind: OutcomeRunnerKind }[] = [];
  for (const r of results) {
    if ("error" in r) errors.push(`${r.stepId}: ${r.error}`);
    else dispatched.push({ stepId: r.stepId, runId: r.runId, runnerKind: r.runnerKind });
  }

  if (!dispatched.length) {
    return { dispatched: [], errors, error: errors[0] ?? "Failed to dispatch live runners" };
  }

  const saved = await mutateOutcome(userId, projectId, (p, now) => {
    let next: OutcomeProject = p;
    for (const d of dispatched) {
      const updated = attachStepRun(next, d.stepId, {
        runnerKind: d.runnerKind,
        runId: d.runId,
        runNote: `Dispatched ${d.runnerKind} mission #${d.runId.slice(0, 8)}`,
        now,
      });
      if (typeof updated !== "string") next = updated;
    }
    return next;
  });

  if (saved.error || !saved.project) {
    return { dispatched, errors, error: saved.error ?? "Could not persist dispatched runs" };
  }
  return { project: saved.project, dispatched, errors };
}

type MissionRow = { id: string; chain_id: string | null; version: number; doc: MissionDoc; created_at: string };

/** Read live mission status/receipts for all linked runIds on a project and reconcile via applyRunnerSync. */
export async function syncProjectRuns(
  sb: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<{ project?: OutcomeProject; synced: number; error?: string }> {
  const project = await loadProject(userId, projectId);
  if (!project) return { synced: 0, error: "Outcome project not found" };

  const linked = project.steps.filter((s) => !s.requiresApproval && Boolean(s.runId));
  if (!linked.length) return { project, synced: 0 };

  const missionMap = new Map<string, MissionView>();
  const recent = await listMissions(sb, userId);
  for (const m of recent) missionMap.set(m.id, m);

  const missingIds = [...new Set(linked.map((s) => s.runId!).filter((id) => !missionMap.has(id)))];
  if (missingIds.length) {
    const { data } = await sb
      .from("missions")
      .select("id, chain_id, version, doc, created_at")
      .eq("user_id", userId)
      .in("id", missingIds);
    for (const row of (data ?? []) as MissionRow[]) {
      const view = await reconcile(sb, userId, row, false);
      missionMap.set(view.id, view);
    }
  }

  let synced = 0;
  const saved = await mutateOutcome(userId, projectId, (p, now) => {
    let next: OutcomeProject = p;
    for (const step of linked) {
      const mission = missionMap.get(step.runId!);
      if (!mission) continue;
      const snap = missionToSnapshot(mission, now);
      const updated = applyRunnerSync(next, step.id, snap);
      if (typeof updated !== "string") {
        next = updated;
        synced++;
      }
    }
    return next;
  });

  if (saved.error || !saved.project) return { synced: 0, error: saved.error ?? "Could not sync runs" };
  return { project: saved.project, synced };
}
