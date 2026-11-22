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
  buildAutoHealPrompt,
  canDispatchStep,
  distillOutcomeToSkill,
  extractOutcomeMistake,
  healableSteps,
  isSafeOutcomeText,
  markOutcomeDistilled,
  pickBackgroundActions,
  readySteps,
  recordCheckResult,
  routeModelForStep,
  selectVerifierForCheck,
  type CheckVerifierKind,
  type OutcomeProject,
  type OutcomeRunnerKind,
  type OutcomeStep,
  type RunnerSyncSnapshot,
} from "./outcome-cockpit-pure";
import { askClaude, recordUsage, SMART_MODEL } from "./claude";
import {
  CRITIC_SYSTEM,
  DEFENSE_SYSTEM,
  applyDebate,
  buildCritiquePrompt,
  buildDefensePrompt,
  endDebate,
  judgeDebate,
  parseObjections,
  parseReplies,
  planReviewPending,
} from "./outcome-debate-pure";
import { addMistake } from "./mistake-memory";
import { proposeOutcomeSkill } from "./skills";
import { auditRemotes } from "./playtesters-pure";
import { stopAllOn } from "./stop-all";

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
  const route = routeModelForStep(step);
  const stepPrompt = [
    `Outcome: ${project.title}`,
    `Brief: ${project.brief}`,
    `Step (${step.planet} / ${runnerKind} runner · model route: ${route.primary}, fallbacks: ${route.fallbacks.join(",") || "none"}): ${step.title}`,
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

  if (planReviewPending(project)) return { error: "The plan is still being reviewed; steps start when it is done (or skip the review)." };
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
  opts?: { autoHeal?: boolean; autoDistill?: boolean },
): Promise<{
  project?: OutcomeProject;
  synced: number;
  healed?: { stepId: string; runId: string }[];
  distilled?: { skillName?: string; mistakesSaved: number };
  error?: string;
}> {
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
  const failedStepIds: string[] = [];
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
        if (snap.state === "failed" || snap.state === "blocked") failedStepIds.push(step.id);
      }
    }
    return next;
  });

  if (saved.error || !saved.project) return { synced: 0, error: saved.error ?? "Could not sync runs" };
  let latest = saved.project;

  // Record concrete failure lessons into Mistake Memory automatically (best-effort, Rule 6 filtered).
  let mistakesSaved = 0;
  for (const sid of failedStepIds) {
    const st = latest.steps.find((s) => s.id === sid);
    const cand = st ? extractOutcomeMistake(latest, st) : null;
    if (cand) {
      try {
        const res = await addMistake(userId, cand);
        if (res.saved) mistakesSaved++;
      } catch { /* best-effort */ }
    }
  }

  // Optional self-healing retry loop for failed `needs_fix` steps (capped at MAX_AUTO_HEAL_RETRIES).
  let healed: { stepId: string; runId: string }[] | undefined;
  if (opts?.autoHeal) {
    const healRes = await dispatchAutoHeal(sb, userId, projectId);
    if (healRes.project) latest = healRes.project;
    if (healRes.healed.length) healed = healRes.healed;
  }

  // Automatic post-outcome skill distillation once all non-approval steps & checks pass.
  let distilledSkillName: string | undefined;
  if (opts?.autoDistill !== false && !latest.distilledSkillAt) {
    const dRes = await distillProjectLearnings(userId, projectId);
    if (dRes.project) latest = dRes.project;
    if (dRes.skillName) distilledSkillName = dRes.skillName;
    mistakesSaved += dRes.mistakesSaved;
  }

  return {
    project: latest,
    synced,
    ...(healed ? { healed } : {}),
    ...(distilledSkillName || mistakesSaved > 0 ? { distilled: { skillName: distilledSkillName, mistakesSaved } } : {}),
  };
}

/** Dispatch targeted self-heal fix mission(s) for failed `needs_fix` steps (reusing verified work, capped at MAX_AUTO_HEAL_RETRIES). */
export async function dispatchAutoHeal(
  sb: SupabaseClient,
  userId: string,
  projectId: string,
  stepId?: string,
): Promise<{ project?: OutcomeProject; healed: { stepId: string; runId: string }[]; errors: string[]; error?: string }> {
  const project = await loadProject(userId, projectId);
  if (!project) return { healed: [], errors: [], error: "Outcome project not found" };

  const candidates = healableSteps(project).filter((h) => !stepId || h.step.id === stepId).slice(0, MAX_PARALLEL_DISPATCH);
  if (!candidates.length) return { project, healed: [], errors: [] };

  const errors: string[] = [];
  const healed: { stepId: string; runId: string; runnerKind: Exclude<OutcomeRunnerKind, "manual"> }[] = [];
  for (const h of candidates) {
    const fixPrompt = buildAutoHealPrompt(project, h);
    const worker = workerAgentFor(h.step);
    const created = await createMission(sb, userId, {
      objective: `[Self-Heal: ${project.title}] Fix ${h.step.title}`.slice(0, 295),
      acceptance: `Fix "${h.step.title}" and produce concrete proof that the previously failed check now passes.`.slice(0, 295),
      constraints: [
        "Fix ONLY the failing part and reuse already-verified work.",
        "Never send, publish, upload, spend, log in, or delete anything automatically (Rule 6).",
        "Never include private journal/LIFE text or credentials (Rule 6).",
      ],
      steps: [
        { agent: worker, request: fixPrompt },
        { agent: "qa", request: `Re-verify "${h.step.title}" after self-heal fix. Confirm concrete proof or report exact remaining blocker honestly.` },
      ],
    });
    if ("error" in created) errors.push(`${h.step.id}: ${created.error}`);
    else healed.push({ stepId: h.step.id, runId: created.id, runnerKind: h.runnerKind });
  }

  if (!healed.length) return { project, healed: [], errors, error: errors[0] ?? "Could not dispatch self-heal" };

  const saved = await mutateOutcome(userId, projectId, (p, now) => {
    let next = p;
    for (const h of healed) {
      const updated = attachStepRun(next, h.stepId, {
        runnerKind: h.runnerKind,
        runId: h.runId,
        runNote: `Self-heal mission #${h.runId.slice(0, 8)} dispatched`,
        now,
      });
      if (typeof updated !== "string") next = updated;
    }
    return next;
  });

  return {
    project: saved.project ?? project,
    healed: healed.map(({ stepId: sid, runId }) => ({ stepId: sid, runId })),
    errors,
    ...(saved.error ? { error: saved.error } : {}),
  };
}

/** Distill a verified Outcome into a reusable Skill Forge proposal and record any failure lessons into Mistake Memory. */
export async function distillProjectLearnings(
  userId: string,
  projectId: string,
): Promise<{ project?: OutcomeProject; skillName?: string; mistakesSaved: number; error?: string }> {
  const project = await loadProject(userId, projectId);
  if (!project) return { mistakesSaved: 0, error: "Outcome project not found" };

  let mistakesSaved = 0;
  for (const step of project.steps) {
    const cand = extractOutcomeMistake(project, step);
    if (!cand) continue;
    try {
      const res = await addMistake(userId, cand);
      if (res.saved) mistakesSaved++;
    } catch { /* best-effort */ }
  }

  if (project.distilledSkillAt) {
    return { project, skillName: project.distilledSkillName, mistakesSaved };
  }

  const draft = distillOutcomeToSkill(project);
  if (!draft) return { project, mistakesSaved };

  const proposed = await proposeOutcomeSkill(draft, project.id);
  if (!proposed.proposed || !proposed.name) {
    return { project, mistakesSaved };
  }

  const saved = await mutateOutcome(userId, projectId, (p, now) =>
    markOutcomeDistilled(p, proposed.name!, now),
  );
  return {
    project: saved.project ?? project,
    skillName: proposed.name,
    mistakesSaved,
    ...(saved.error ? { error: saved.error } : {}),
  };
}

/** Pillar #3: Run a closed-loop local domain check verifier and record honest proof on the outcome. */
export async function runLocalCheckVerifier(
  userId: string,
  projectId: string,
  checkId: string,
  payload?: { luauFiles?: { path: string; code: string }[] },
): Promise<{ project?: OutcomeProject; verifier?: CheckVerifierKind; pass?: boolean; proof?: string; error?: string }> {
  const project = await loadProject(userId, projectId);
  if (!project) return { error: "Outcome project not found" };
  const check = project.checks.find((c) => c.id === checkId);
  if (!check) return { error: "Check not found" };

  const verifier = selectVerifierForCheck(project, check);
  let pass = false;
  let proof = "";

  if (verifier === "roblox-audit") {
    const files = Array.isArray(payload?.luauFiles) ? payload.luauFiles.filter((f) => f && typeof f.path === "string" && typeof f.code === "string") : [];
    if (!files.length) {
      return { error: "Provide luauFiles [{ path, code }] to run the Roblox exploit audit verifier." };
    }
    const findings = auditRemotes(files.map((f) => ({ file: f.path, text: f.code })));
    const high = findings.filter((f) => f.severity === "high");
    pass = high.length === 0;
    proof = pass
      ? `Roblox auditRemotes passed: 0 high-severity findings across ${files.length} Luau file(s).`
      : `Roblox auditRemotes failed: ${high.length} high-severity exploit finding(s) (${high.slice(0, 2).map((f) => f.file).join(", ")}).`;
  } else {
    const linkedStep = check.fixesStepId ? project.steps.find((s) => s.id === check.fixesStepId) : undefined;
    pass = Boolean(linkedStep && linkedStep.status === "verified" && (linkedStep.note || linkedStep.runNote));
    proof = pass
      ? `${verifier} verified from step "${linkedStep!.title}": ${linkedStep!.note || linkedStep!.runNote}`
      : `${verifier} check failed: linked step is not verified with concrete proof yet.`;
  }

  const saved = await mutateOutcome(userId, projectId, (p, now) => recordCheckResult(p, checkId, pass, proof, now));
  if (saved.error || !saved.project) return { error: saved.error ?? "Could not record check result" };
  return { project: saved.project, verifier, pass, proof };
}

const reviewsRunning = new Set<string>();

/** Critic vs planner, before any step runs. Two Opus calls with every tool off: the critic attacks the plan, the planner
 *  answers each objection, and judgeDebate decides deterministically what survives. Surviving objections become new
 *  checks; nothing is removed or loosened. Any failure ends the review as "failed" and the plan runs unchanged. */
export async function runPlanReview(
  sb: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<{ project?: OutcomeProject; error?: string }> {
  const key = `${userId}:${projectId}`;
  if (reviewsRunning.has(key)) return { error: "The plan review is already running." };
  const project = await loadProject(userId, projectId);
  if (!project) return { error: "Outcome project not found" };
  if (!planReviewPending(project)) return { project };
  if (stopAllOn()) return { project, error: "Stop-all is on." };
  reviewsRunning.add(key);
  try {
    const critic = await askClaude(buildCritiquePrompt(project), CRITIC_SYSTEM, { purpose: "outcome.critic.review", model: SMART_MODEL, risky: true });
    await recordUsage(sb, userId, "outcome.critic.review", critic, SMART_MODEL);
    const objections = parseObjections(critic.text, project);
    if (!objections) {
      return mutateOutcome(userId, projectId, (p, now) => endDebate(p, "failed", "The critic's reply was unreadable; the plan runs as written.", now));
    }
    let judged = objections;
    const open = objections.filter((o) => o.verdict !== "refused");
    if (open.length) {
      const planner = await askClaude(buildDefensePrompt(project, open), DEFENSE_SYSTEM, { purpose: "outcome.planner.review", model: SMART_MODEL, risky: true });
      await recordUsage(sb, userId, "outcome.planner.review", planner, SMART_MODEL);
      judged = judgeDebate(objections, parseReplies(planner.text));
    }
    // the plan may have been edited meanwhile: apply to the latest copy, and only if it is still pending
    return mutateOutcome(userId, projectId, (p, now) => (planReviewPending(p) ? applyDebate(p, judged, now) : p));
  } catch (e) {
    console.error("[orbit] outcome plan review failed", e);
    const why = e instanceof Error ? e.message.slice(0, 120) : "unknown error";
    return mutateOutcome(userId, projectId, (p, now) => (planReviewPending(p) ? endDebate(p, "failed", `Plan review failed (${why}); the plan runs as written.`, now) : p));
  } finally {
    reviewsRunning.delete(key);
  }
}

/** Pillar #5: Advance active outcomes safely in the background (respects Stop-all & Rule 6 approval gates). */
export async function advanceOutcomesBackground(
  sb: SupabaseClient,
  userId: string,
  opts?: { maxActions?: number },
): Promise<{
  skipped?: string;
  actions: number;
  synced: number;
  healed: number;
  dispatched: number;
  distilled: number;
}> {
  if (stopAllOn()) return { skipped: "stop-all", actions: 0, synced: 0, healed: 0, dispatched: 0, distilled: 0 };
  const projects = await listOutcomes(userId);
  const plan = pickBackgroundActions(projects, opts);
  let synced = 0, healed = 0, dispatched = 0, distilled = 0;

  for (const item of plan) {
    if (stopAllOn()) break;
    if (item.action === "plan_review") {
      await runPlanReview(sb, userId, item.projectId);
    } else if (item.action === "sync") {
      const r = await syncProjectRuns(sb, userId, item.projectId, { autoHeal: true, autoDistill: true });
      synced += r.synced;
      healed += r.healed?.length ?? 0;
      if (r.distilled?.skillName) distilled++;
    } else if (item.action === "auto_heal") {
      const r = await dispatchAutoHeal(sb, userId, item.projectId);
      healed += r.healed.length;
    } else if (item.action === "run_ready") {
      const r = await dispatchReadyRuns(sb, userId, item.projectId);
      dispatched += r.dispatched.length;
    } else if (item.action === "distill") {
      const r = await distillProjectLearnings(userId, item.projectId);
      if (r.skillName) distilled++;
    }
  }
  return { actions: plan.length, synced, healed, dispatched, distilled };
}
