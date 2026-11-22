// ORBIT Outcome Engine — Project Cockpit (pure domain model, parallel DAG scheduler, honest verification gate,
// Rule 6 privacy & approval walls). Zero I/O; tested in tests/outcome-cockpit.test.ts.
import { isPrivate } from "./private-pure.ts";

export const OUTCOME_PLANETS = ["core", "studio", "gamedev", "business", "research", "vault", "operations"] as const;
export type OutcomePlanet = (typeof OUTCOME_PLANETS)[number];

export type OutcomeTemplateId = "roblox-update" | "week-of-shorts" | "client-shop" | "custom";
export type StepKind = "research" | "build" | "asset" | "verify" | "approval";
export type StepStatus = "queued" | "running" | "verifying" | "needs_fix" | "verified" | "waiting_approval" | "blocked";
export type ApprovalKind = "send" | "publish" | "upload" | "spend";
export type CheckStatus = "pending" | "pass" | "fail";
export type OutcomeStatus = "active" | "verifying" | "needs_fix" | "waiting_approval" | "blocked" | "verified";
export type OutcomeRunnerKind = "mission" | "workspace" | "studio" | "manual";
export type OutcomeRunState = "queued" | "running" | "done" | "failed" | "blocked";

export type OutcomeStep = {
  id: string;
  title: string;
  planet: OutcomePlanet;
  agent: string;
  kind: StepKind;
  dependsOn: string[];
  status: StepStatus;
  reused?: boolean;
  retries: number;
  note?: string;
  link?: string;
  taskId?: string;
  requiresApproval?: ApprovalKind;
  approvalId?: string;
  runnerKind?: OutcomeRunnerKind;
  runId?: string;
  runState?: OutcomeRunState;
  runNote?: string;
  lastRunAt?: string;
};

export type OutcomeCheck = {
  id: string;
  label: string;
  scope: "deliverable" | "security" | "build" | "qa";
  status: CheckStatus;
  proof?: string;
  fixesStepId?: string;
  updatedAt?: string;
};

export type OutcomeDeliverable = {
  id: string;
  title: string;
  kind: "site" | "clips" | "roblox" | "doc" | "asset";
  summary: string;
  href?: string;
  changed?: string;
  verified: boolean;
};

export type OutcomeBlocker = {
  id: string;
  stepId?: string;
  message: string;
  resolved: boolean;
  at: string;
};

export type OutcomeApproval = {
  id: string;
  kind: ApprovalKind;
  title: string;
  detail: string;
  target: string;
  status: "waiting" | "approved" | "rejected";
  decidedAt?: string;
};

export type OutcomeProject = {
  id: string;
  title: string;
  brief: string;
  template: OutcomeTemplateId;
  planets: OutcomePlanet[];
  steps: OutcomeStep[];
  checks: OutcomeCheck[];
  deliverables: OutcomeDeliverable[];
  blockers: OutcomeBlocker[];
  approvals: OutcomeApproval[];
  createdAt: string;
  updatedAt: string;
};

export type OutcomeStore = { v: 1; users: Record<string, { items: OutcomeProject[] }> };

export const MAX_OUTCOMES_PER_USER = 30;
const PRIVATE_TEXT_RE = /\b(journal|diary|päevik|private|confidential|password|secret[_ -]?key|sk-[a-z0-9]{12,}|eyJ[a-zA-Z0-9_-]{20,})\b/i;

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Rule 6 privacy wall: journal/LIFE text and secrets never enter Outcome Engine projects. */
export function isSafeOutcomeText(text: string): boolean {
  if (!text.trim()) return true;
  if (PRIVATE_TEXT_RE.test(text)) return false;
  const words = text.toLowerCase().split(/[^a-z0-9õäöüšž]+/i).filter(Boolean);
  return !isPrivate({ tags: words });
}

export type OutcomeTemplateSpec = {
  id: Exclude<OutcomeTemplateId, "custom">;
  title: string;
  brief: string;
  planets: OutcomePlanet[];
};

export const OUTCOME_TEMPLATES: readonly OutcomeTemplateSpec[] = [
  {
    id: "roblox-update",
    title: "Launch this Roblox update",
    brief: "Build, asset-prep, playtest, verify exploits & economy, and stage Studio publish for approval.",
    planets: ["gamedev", "vault", "operations"],
  },
  {
    id: "week-of-shorts",
    title: "Make a week of Shorts",
    brief: "Scout outliers, cut and dub 7 Shorts (EN/ET), verify audio/captions & hooks, and queue schedule approval.",
    planets: ["research", "studio", "operations"],
  },
  {
    id: "client-shop",
    title: "Turn this client idea into a shop",
    brief: "Verify business details, build a full-stack demo shop with real assets, verify render/API/facts, and stage outreach approval.",
    planets: ["business", "core", "vault", "operations"],
  },
] as const;

export function createOutcomeFromTemplate(
  template: OutcomeTemplateId,
  opts: { title?: string; brief?: string; id: string; now: string },
): OutcomeProject | string {
  const titleIn = clean(opts.title, 120);
  const briefIn = clean(opts.brief, 600);
  if (!isSafeOutcomeText(`${titleIn} ${briefIn}`)) {
    return "Private journal/LIFE text or credentials cannot be stored in an Outcome project (Rule 6).";
  }

  if (template === "roblox-update") {
    return {
      id: opts.id,
      title: titleIn || "Launch this Roblox update",
      brief: briefIn || OUTCOME_TEMPLATES[0].brief,
      template,
      planets: ["gamedev", "vault", "operations"],
      steps: [
        { id: "s1", title: "Draft & sync Luau gameplay scripts (Rojo)", planet: "gamedev", agent: "forge", kind: "build", dependsOn: [], status: "queued", retries: 0, link: "#o=gamedev" },
        { id: "s2", title: "Prepare 3D draft meshes & UI kit assets", planet: "vault", agent: "nova", kind: "asset", dependsOn: [], status: "queued", retries: 0, link: "#o=vault" },
        { id: "s3", title: "Run 6 AI playtesters, exploit audit & economy sim", planet: "gamedev", agent: "qa", kind: "verify", dependsOn: ["s1", "s2"], status: "queued", retries: 0, link: "#o=gamedev" },
        { id: "s4", title: "Publish Roblox update in Studio (owner click)", planet: "operations", agent: "core", kind: "approval", dependsOn: ["s3"], status: "waiting_approval", retries: 0, requiresApproval: "publish", approvalId: "a1", link: "#o=gamedev" },
      ],
      checks: [
        { id: "c1", label: "Selene lint & Rojo .rbxl build clean", scope: "build", status: "pending", fixesStepId: "s1" },
        { id: "c2", label: "Zero critical RemoteEvent / economy exploits", scope: "security", status: "pending", fixesStepId: "s3" },
        { id: "c3", label: "6-persona playtest & progression curve verified", scope: "qa", status: "pending", fixesStepId: "s3" },
      ],
      deliverables: [
        { id: "d1", title: "Rojo build + Luau diff & Selene report", kind: "roblox", summary: "Synced scripts ready for Studio review.", href: "#o=gamedev", verified: false },
        { id: "d2", title: "Playtest heatmap & economy balance sheet", kind: "doc", summary: "Six AI persona runs + balance simulation.", href: "#o=gamedev", verified: false },
      ],
      blockers: [],
      approvals: [
        { id: "a1", kind: "publish", title: "Publish Roblox place update", detail: "Nothing publishes automatically. Review the build & playtest proof, then publish in Roblox Studio.", target: "GAME DEV → Build", status: "waiting" },
      ],
      createdAt: opts.now,
      updatedAt: opts.now,
    };
  }

  if (template === "week-of-shorts") {
    return {
      id: opts.id,
      title: titleIn || "Make a week of Shorts",
      brief: briefIn || OUTCOME_TEMPLATES[1].brief,
      template,
      planets: ["research", "studio", "operations"],
      steps: [
        { id: "s1", title: "Scout outlier hooks & trending topics", planet: "research", agent: "atlas", kind: "research", dependsOn: [], status: "queued", retries: 0, link: "#o=studio" },
        { id: "s2", title: "Cut 7 Shorts & render EN/ET voiceovers", planet: "studio", agent: "nova", kind: "build", dependsOn: [], status: "queued", retries: 0, link: "#o=studio" },
        { id: "s3", title: "Package titles, thumbnails & honest A/B test plan", planet: "studio", agent: "qa", kind: "verify", dependsOn: ["s1", "s2"], status: "queued", retries: 0, link: "#o=studio" },
        { id: "s4", title: "Schedule & upload approved Shorts (owner click)", planet: "operations", agent: "core", kind: "approval", dependsOn: ["s3"], status: "waiting_approval", retries: 0, requiresApproval: "upload", approvalId: "a1", link: "#o=studio" },
      ],
      checks: [
        { id: "c1", label: "All 7 vertical clips rendered cleanly (no black frames)", scope: "deliverable", status: "pending", fixesStepId: "s2" },
        { id: "c2", label: "Captions, audio loudness & commercial-OK voice verified", scope: "qa", status: "pending", fixesStepId: "s2" },
        { id: "c3", label: "Packaging & A/B variants reviewed", scope: "deliverable", status: "pending", fixesStepId: "s3" },
      ],
      deliverables: [
        { id: "d1", title: "7 Shorts batch (EN + ET dubs)", kind: "clips", summary: "Ready for one-desk review in Clip Factory.", href: "#o=studio", verified: false },
      ],
      blockers: [],
      approvals: [
        { id: "a1", kind: "upload", title: "Schedule approved Shorts to YouTube", detail: "Uploading/scheduling always waits for your explicit click after reviewing the 7 clips.", target: "STUDIO → Review", status: "waiting" },
      ],
      createdAt: opts.now,
      updatedAt: opts.now,
    };
  }

  if (template === "client-shop") {
    return {
      id: opts.id,
      title: titleIn || "Turn this client idea into a shop",
      brief: briefIn || OUTCOME_TEMPLATES[2].brief,
      template,
      planets: ["business", "core", "vault", "operations"],
      steps: [
        { id: "s1", title: "Verify client company facts (e-Business Register)", planet: "business", agent: "atlas", kind: "research", dependsOn: [], status: "queued", retries: 0, link: "#o=business" },
        { id: "s2", title: "Generate offline-ready visual assets & product shots", planet: "vault", agent: "nova", kind: "asset", dependsOn: [], status: "queued", retries: 0, link: "#o=vault" },
        { id: "s3", title: "Build full-stack shop workspace (catalog, cart, admin)", planet: "core", agent: "forge", kind: "build", dependsOn: ["s1", "s2"], status: "queued", retries: 0, link: "#o=core" },
        { id: "s4", title: "Verify desktop/mobile render, API round-trip & claims", planet: "operations", agent: "qa", kind: "verify", dependsOn: ["s3"], status: "queued", retries: 0, link: "#o=operations" },
        { id: "s5", title: "Send client preview & proposal email (owner click)", planet: "business", agent: "echo", kind: "approval", dependsOn: ["s4"], status: "waiting_approval", retries: 0, requiresApproval: "send", approvalId: "a1", link: "#o=business" },
      ],
      checks: [
        { id: "c1", label: "All business claims match verified registry/public sources", scope: "qa", status: "pending", fixesStepId: "s1" },
        { id: "c2", label: "Desktop + mobile headless preview renders cleanly", scope: "deliverable", status: "pending", fixesStepId: "s3" },
        { id: "c3", label: "Order / quote POST API persists and lists in admin", scope: "build", status: "pending", fixesStepId: "s3" },
      ],
      deliverables: [
        { id: "d1", title: "Full-stack demo shop workspace", kind: "site", summary: "Offline-sandboxed interactive preview + downloadable .zip.", href: "#o=core", verified: false },
        { id: "d2", title: "Outreach email draft (unsent)", kind: "doc", summary: "Prepared in BUSINESS; waits for your click to send.", href: "#o=business", verified: false },
      ],
      blockers: [],
      approvals: [
        { id: "a1", kind: "send", title: "Send demo shop link to client", detail: "Outbound email never sends automatically. Review the verified shop & draft first.", target: "BUSINESS → Outreach", status: "waiting" },
      ],
      createdAt: opts.now,
      updatedAt: opts.now,
    };
  }

  if (titleIn.length < 3) return "Outcome title must be at least 3 characters.";
  return {
    id: opts.id,
    title: titleIn,
    brief: briefIn || `Carry "${titleIn}" across ORBIT until all agreed checks pass and the deliverable is ready to review.`,
    template: "custom",
    planets: ["core", "research", "operations"],
    steps: [
      { id: "s1", title: "Gather brief, facts & existing ORBIT assets", planet: "research", agent: "atlas", kind: "research", dependsOn: [], status: "queued", retries: 0, link: "#o=core" },
      { id: "s2", title: "Build primary deliverable", planet: "core", agent: "forge", kind: "build", dependsOn: ["s1"], status: "queued", retries: 0, link: "#o=core" },
      { id: "s3", title: "Run agreed deliverable checks", planet: "operations", agent: "qa", kind: "verify", dependsOn: ["s2"], status: "queued", retries: 0, link: "#o=operations" },
      { id: "s4", title: "Owner review & external release approval", planet: "operations", agent: "core", kind: "approval", dependsOn: ["s3"], status: "waiting_approval", retries: 0, requiresApproval: "publish", approvalId: "a1", link: "#o=operations" },
    ],
    checks: [
      { id: "c1", label: "Deliverable builds & renders without errors", scope: "build", status: "pending", fixesStepId: "s2" },
      { id: "c2", label: "Claims & output verified against evidence", scope: "qa", status: "pending", fixesStepId: "s3" },
    ],
    deliverables: [
      { id: "d1", title: `${titleIn} deliverable`, kind: "doc", summary: "Reviewable output attached to this outcome.", href: "#o=core", verified: false },
    ],
    blockers: [],
    approvals: [
      { id: "a1", kind: "publish", title: `Approve external action for "${titleIn}"`, detail: "Sending, publishing, uploading, or spending always waits for your explicit click.", target: "Review Desk", status: "waiting" },
    ],
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}

/** Independent queued steps whose dependencies are all verified — ready to execute in parallel right now. */
export function readySteps(p: OutcomeProject): OutcomeStep[] {
  const verifiedIds = new Set(p.steps.filter((s) => s.status === "verified").map((s) => s.id));
  return p.steps.filter(
    (s) => s.status === "queued" && !s.requiresApproval && s.dependsOn.every((dep) => verifiedIds.has(dep)),
  );
}

/** Honest project status: NEVER returns "verified" until every check passes, every step is verified, and zero approvals/blockers remain. */
export function deriveOutcomeStatus(p: OutcomeProject): OutcomeStatus {
  if (p.blockers.some((b) => !b.resolved) || p.steps.some((s) => s.status === "blocked")) return "blocked";
  if (p.checks.some((c) => c.status === "fail") || p.steps.some((s) => s.status === "needs_fix")) return "needs_fix";
  const allChecksPass = p.checks.length > 0 && p.checks.every((c) => c.status === "pass");
  const nonApprovalDone = p.steps.filter((s) => !s.requiresApproval).every((s) => s.status === "verified");
  const waitingApprovals = p.approvals.some((a) => a.status === "waiting");
  if (allChecksPass && nonApprovalDone && waitingApprovals) return "waiting_approval";
  if (allChecksPass && p.steps.every((s) => s.status === "verified") && !waitingApprovals) return "verified";
  if (p.steps.some((s) => s.status === "verifying") || (nonApprovalDone && !allChecksPass)) return "verifying";
  return "active";
}

/** Start all currently independent parallel-ready steps in one click. */
export function startReadySteps(p: OutcomeProject, now: string): OutcomeProject {
  const ready = new Set(readySteps(p).map((s) => s.id));
  if (!ready.size) return p;
  return {
    ...p,
    updatedAt: now,
    steps: p.steps.map((s) => (ready.has(s.id) ? { ...s, status: "running" } : s)),
  };
}

/** Update a single step (mark verified, reused, running, or blocked). Never bypasses an approval-gated step. */
export function updateStepStatus(
  p: OutcomeProject,
  stepId: string,
  status: Exclude<StepStatus, "waiting_approval">,
  opts: { reused?: boolean; note?: string; now: string },
): OutcomeProject | string {
  const step = p.steps.find((s) => s.id === stepId);
  if (!step) return "Step not found";
  if (step.requiresApproval && status === "verified") {
    return "Approval-gated steps can only be completed by clicking Approve on the Review Desk (Rule 6).";
  }
  const note = opts.note !== undefined ? clean(opts.note, 240) : step.note;
  if (note && !isSafeOutcomeText(note)) return "Private journal/LIFE text cannot be saved on a step.";
  const steps = p.steps.map((s) =>
    s.id === stepId ? { ...s, status, reused: opts.reused ?? s.reused, ...(note ? { note } : {}) } : s,
  );
  const blockers = status === "verified"
    ? p.blockers.map((b) => (b.stepId === stepId ? { ...b, resolved: true } : b))
    : p.blockers;
  return { ...p, updatedAt: opts.now, steps, blockers };
}

/** Record an honest verification check result. A failure NEVER hides — it flags the linked step `needs_fix` and opens a blocker. */
export function recordCheckResult(
  p: OutcomeProject,
  checkId: string,
  pass: boolean,
  proof: string,
  now: string,
): OutcomeProject | string {
  const chk = p.checks.find((c) => c.id === checkId);
  if (!chk) return "Check not found";
  const cleanProof = clean(proof, 240);
  if (!isSafeOutcomeText(cleanProof)) return "Private journal/LIFE text cannot be saved in check proof.";
  const checks: OutcomeCheck[] = p.checks.map((c) =>
    c.id === checkId ? { ...c, status: pass ? "pass" : "fail", proof: cleanProof || (pass ? "Verified" : "Failed check"), updatedAt: now } : c,
  );
  let steps = p.steps;
  let blockers = p.blockers;
  if (!pass) {
    const targetId = chk.fixesStepId ?? p.steps.findLast((s) => s.kind === "build" || s.kind === "verify")?.id;
    steps = p.steps.map((s) =>
      s.id === targetId ? { ...s, status: "needs_fix", retries: s.retries + 1, note: cleanProof || `Fix required: ${chk.label}` } : s,
    );
    const bId = `blk-${checkId}`;
    const msg = `${chk.label}: ${cleanProof || "failed check — fix and retry"}`;
    blockers = [
      ...p.blockers.filter((b) => b.id !== bId),
      { id: bId, stepId: targetId, message: msg, resolved: false, at: now },
    ];
  } else {
    blockers = p.blockers.map((b) => (b.id === `blk-${checkId}` ? { ...b, resolved: true } : b));
  }
  const allChecksPass = checks.every((c) => c.status === "pass");
  const deliverables = p.deliverables.map((d) => ({ ...d, verified: allChecksPass }));
  return { ...p, updatedAt: now, checks, steps, blockers, deliverables };
}

/** Targeted Fix & Retry: restarts ONLY the failed/blocked step, clears its blocker, resets its failed check(s) to pending, and keeps already-verified work intact. */
export function retryFixStep(p: OutcomeProject, stepId: string, now: string): OutcomeProject | string {
  const step = p.steps.find((s) => s.id === stepId);
  if (!step) return "Step not found";
  if (step.requiresApproval) return "Approval steps wait for your Approve click.";
  const steps = p.steps.map((s) =>
    s.id === stepId
      ? { ...s, status: "running" as const, retries: s.retries + 1 }
      : s.status === "verified" ? { ...s, reused: true } : s,
  );
  const checks = p.checks.map((c) =>
    c.fixesStepId === stepId && c.status === "fail" ? { ...c, status: "pending" as const, updatedAt: now } : c,
  );
  const blockers = p.blockers.map((b) => (b.stepId === stepId ? { ...b, resolved: true } : b));
  return { ...p, updatedAt: now, steps, checks, blockers };
}

/** Explicit owner-click approval gate (Rule 6: send/publish/upload/spend). */
export function decideApproval(
  p: OutcomeProject,
  approvalId: string,
  decision: "approved" | "rejected",
  now: string,
): OutcomeProject | string {
  const app = p.approvals.find((a) => a.id === approvalId);
  if (!app) return "Approval not found";
  if (decision === "approved" && p.checks.some((c) => c.status !== "pass")) {
    return "All agreed checks must pass before approving external release.";
  }
  const approvals = p.approvals.map((a) =>
    a.id === approvalId ? { ...a, status: decision, decidedAt: now } : a,
  );
  const steps = p.steps.map((s) =>
    s.approvalId === approvalId ? { ...s, status: decision === "approved" ? ("verified" as const) : ("blocked" as const) } : s,
  );
  return { ...p, updatedAt: now, approvals, steps };
}

/** Map an OutcomeStep to its ORBIT live runner. NEVER returns an auto-runner for approval-gated steps (Rule 6). */
export function pickRunnerKind(step: Pick<OutcomeStep, "planet" | "kind" | "requiresApproval">): OutcomeRunnerKind {
  if (step.requiresApproval || step.kind === "approval") return "manual";
  if (step.planet === "studio" || step.planet === "gamedev" || step.kind === "asset") return "studio";
  if (step.kind === "build" && (step.planet === "core" || step.planet === "business")) return "workspace";
  return "mission";
}

/** Rule 6 pre-dispatch gate: refuses approval-gated steps and any LIFE/journal/secret text before a live runner is touched. */
export function canDispatchStep(
  p: Pick<OutcomeProject, "title" | "brief">,
  step: Pick<OutcomeStep, "title" | "planet" | "kind" | "requiresApproval" | "note">,
): { ok: true; runnerKind: Exclude<OutcomeRunnerKind, "manual"> } | { ok: false; error: string } {
  const runnerKind = pickRunnerKind(step);
  if (runnerKind === "manual") {
    return { ok: false, error: "Approval-gated steps cannot be auto-dispatched; wait for explicit owner approval (Rule 6)." };
  }
  const combined = [p.title, p.brief, step.title, step.note ?? ""].join(" ");
  if (!isSafeOutcomeText(combined)) {
    return { ok: false, error: "Private journal/LIFE text or credentials cannot be dispatched to a live runner (Rule 6)." };
  }
  return { ok: true, runnerKind };
}

/** Record a newly dispatched live runner (e.g. ORBIT Mission id) onto a step. */
export function attachStepRun(
  p: OutcomeProject,
  stepId: string,
  run: { runnerKind: OutcomeRunnerKind; runId: string; runNote?: string; now: string },
): OutcomeProject | string {
  const step = p.steps.find((s) => s.id === stepId);
  if (!step) return "Step not found";
  const gate = canDispatchStep(p, step);
  if (!gate.ok) return gate.error;
  const runId = clean(run.runId, 120);
  if (!runId) return "runId is required";
  const runNote = run.runNote !== undefined ? clean(run.runNote, 240) : undefined;
  if (runNote && !isSafeOutcomeText(runNote)) return "Private journal/LIFE text cannot be saved on a step.";
  const steps = p.steps.map((s) =>
    s.id === stepId
      ? {
          ...s,
          status: "running" as const,
          runnerKind: run.runnerKind === "manual" ? gate.runnerKind : run.runnerKind,
          runId,
          taskId: runId,
          runState: "running" as const,
          ...(runNote ? { runNote } : {}),
          lastRunAt: run.now,
        }
      : s,
  );
  const blockers = p.blockers.map((b) => (b.stepId === stepId ? { ...b, resolved: true } : b));
  return { ...p, updatedAt: run.now, steps, blockers };
}

export type RunnerSyncSnapshot = {
  state: OutcomeRunState;
  note?: string;
  proof?: string;
  verified?: boolean;
  now: string;
};

/** Reconcile a live runner's status/receipts back into a step honestly — never fakes verified if checks/proof are missing or approvals remain. */
export function applyRunnerSync(
  p: OutcomeProject,
  stepId: string,
  snapshot: RunnerSyncSnapshot,
): OutcomeProject | string {
  const step = p.steps.find((s) => s.id === stepId);
  if (!step) return "Step not found";
  if (step.requiresApproval) {
    return "Approval-gated steps cannot be synced to verified; use Approve on the Review Desk (Rule 6).";
  }
  const cleanNote = snapshot.note !== undefined ? clean(snapshot.note, 240) : "";
  const cleanProof = snapshot.proof !== undefined ? clean(snapshot.proof, 240) : "";
  if ((cleanNote && !isSafeOutcomeText(cleanNote)) || (cleanProof && !isSafeOutcomeText(cleanProof))) {
    return "Private journal/LIFE text cannot be synced onto a step (Rule 6).";
  }

  const bId = `blk-run-${stepId}`;
  let nextStatus: StepStatus = step.status;
  let retries = step.retries;
  let note = step.note;
  let blockers = p.blockers;

  if (snapshot.state === "queued" || snapshot.state === "running") {
    if (step.status !== "verified") nextStatus = "running";
  } else if (snapshot.state === "done") {
    if (snapshot.verified === false) {
      // Honest gate: runner finished without verified proof — hold at verifying, never claim verified.
      nextStatus = "verifying";
      note = cleanNote || cleanProof || "Runner finished without verified proof — review checks before marking verified.";
    } else {
      nextStatus = "verified";
      note = cleanProof || cleanNote || step.note;
      blockers = p.blockers.map((b) => (b.stepId === stepId ? { ...b, resolved: true } : b));
    }
  } else if (snapshot.state === "failed") {
    nextStatus = "needs_fix";
    retries = step.retries + 1;
    note = cleanNote || "Live runner failed — fix and retry.";
    blockers = [
      ...p.blockers.filter((b) => b.id !== bId),
      { id: bId, stepId, message: `${step.title}: ${cleanNote || "live runner failed"}`, resolved: false, at: snapshot.now },
    ];
  } else if (snapshot.state === "blocked") {
    nextStatus = "blocked";
    note = cleanNote || "Live runner blocked — needs your input.";
    blockers = [
      ...p.blockers.filter((b) => b.id !== bId),
      { id: bId, stepId, message: `${step.title}: ${cleanNote || "live runner blocked"}`, resolved: false, at: snapshot.now },
    ];
  }

  const runNote = cleanNote || cleanProof || step.runNote;
  const steps = p.steps.map((s) =>
    s.id === stepId
      ? {
          ...s,
          status: nextStatus,
          retries,
          ...(note ? { note } : {}),
          runState: snapshot.state,
          ...(runNote ? { runNote } : {}),
          lastRunAt: snapshot.now,
        }
      : s,
  );
  return { ...p, updatedAt: snapshot.now, steps, blockers };
}

export type ReviewDeskSummary = {
  status: OutcomeStatus;
  pct: number;
  doneSteps: number;
  totalSteps: number;
  parallelReady: number;
  reusedSteps: number;
  checksPassed: number;
  checksFailed: number;
  checksTotal: number;
  openBlockers: number;
  waitingApprovals: number;
  canApprove: boolean;
};

export function reviewDeskSummary(p: OutcomeProject): ReviewDeskSummary {
  const totalSteps = p.steps.length || 1;
  const doneSteps = p.steps.filter((s) => s.status === "verified").length;
  const checksTotal = p.checks.length;
  const checksPassed = p.checks.filter((c) => c.status === "pass").length;
  const checksFailed = p.checks.filter((c) => c.status === "fail").length;
  const openBlockers = p.blockers.filter((b) => !b.resolved).length;
  const waitingApprovals = p.approvals.filter((a) => a.status === "waiting").length;
  const pct = Math.round(((doneSteps + checksPassed) / (totalSteps + Math.max(1, checksTotal))) * 100);
  return {
    status: deriveOutcomeStatus(p),
    pct,
    doneSteps,
    totalSteps: p.steps.length,
    parallelReady: readySteps(p).length,
    reusedSteps: p.steps.filter((s) => s.reused).length,
    checksPassed,
    checksFailed,
    checksTotal,
    openBlockers,
    waitingApprovals,
    canApprove: checksTotal > 0 && checksPassed === checksTotal && openBlockers === 0 && waitingApprovals > 0,
  };
}

export function parseOutcomeStore(raw: string | null): OutcomeStore {
  if (!raw?.trim()) return { v: 1, users: {} };
  try {
    const o = JSON.parse(raw) as OutcomeStore;
    if (!o || typeof o !== "object" || !o.users || typeof o.users !== "object") return { v: 1, users: {} };
    return { v: 1, users: o.users };
  } catch {
    return { v: 1, users: {} };
  }
}
