// Activity log: pure parts (JSONL parse/trim, rows → items, merge), tested in tests/activity.test.ts.
import { PLANETS } from "./planets.ts";

// Server glue: activity.ts (append-only JSONL for events with no other record); API: /api/activity; UI: ActivityView (OPERATIONS).

export const ACT_AREAS = ["agents", "chains", "goals", "automations", "autopilot", "clips", "core", "operator", "system"] as const;
export type ActArea = (typeof ACT_AREAS)[number];
export type ActLink = { task?: string; panel?: string };
/** How to reverse an autonomous action: delete the memory it saved, or rename a VAULT file back (`to` = its old name). */
export type ActUndo = { kind: "memory"; id: string } | { kind: "vault-rename"; id: string; to: string };
/** undid: the undoKey() of the action this line reversed. */
export type ActItem = { at: string; area: ActArea; title: string; detail?: string; link?: ActLink; undo?: ActUndo; undid?: string };
export const ACT_MAX = 5000; // lines kept in activity.jsonl

const PANELS = new Set<string>([...PLANETS.map((p) => p.id), "core", "profile"]);
/** Only a task id or a known panel survives (the UI dispatches it as navigation). */
export function cleanLink(l: unknown): ActLink | undefined {
  if (!l || typeof l !== "object") return undefined;
  const { task, panel } = l as Record<string, unknown>;
  if (typeof task === "string" && /^[\w-]{1,64}$/.test(task)) return { task };
  if (typeof panel === "string" && PANELS.has(panel)) return { panel };
  return undefined;
}
const isArea = (a: unknown): a is ActArea => (ACT_AREAS as readonly string[]).includes(a as string);
const cut = (s: unknown, n: number) => String(s ?? "").slice(0, n);

/** JSONL text → items; malformed lines are skipped. */
export function parseActivity(text: string): ActItem[] {
  const out: ActItem[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (!o || typeof o.at !== "string" || !isArea(o.area) || typeof o.title !== "string" || Number.isNaN(Date.parse(o.at))) continue;
      const undo = cleanUndo(o.undo);
      out.push({ at: o.at, area: o.area, title: cut(o.title, 300), ...(o.detail ? { detail: cut(o.detail, 500) } : {}), ...(cleanLink(o.link) ? { link: cleanLink(o.link) } : {}),
        ...(undo ? { undo } : {}), ...(typeof o.undid === "string" ? { undid: cut(o.undid, 400) } : {}) });
    } catch { /* skip */ }
  }
  return out;
}

/** The last `max` non-empty lines (newline-terminated): the rotation keeps the newest. */
export function keepLast(text: string, max = ACT_MAX): string {
  const lines = text.split("\n").filter((l) => l.trim());
  return lines.slice(-max).join("\n") + (lines.length ? "\n" : "");
}

/** All sources → one list, newest first, optionally one area only. */
export function mergeActivity(lists: ActItem[][], area?: string, limit = 200): ActItem[] {
  return lists.flat().filter((x) => !area || x.area === area).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}

type TaskRow = {
  id: string; parent_id: string | null; agent: string; title: string; status: string; automation_id?: string | null; error?: string | null;
  trace?: { step: string; ok: boolean }[] | null; pending?: { tool: string; status: string }[] | null;
  created_at: string; started_at: string | null; finished_at: string | null;
};
const STATUS: Record<string, string> = { queued: "Queued", running: "Running", awaiting_approval: "Needs approval", done: "Done", failed: "Failed", cancelled: "Cancelled" };
const INNER = new Set(["think", "verify", "review", "error"]);

/** Agent tasks (incl. team-chain steps, goal steps, automation runs) → one item each; the tools it used and its approvals in the detail. */
export function taskItems(rows: TaskRow[]): ActItem[] {
  return rows.map((t) => {
    const area: ActArea = t.automation_id ? "automations" : t.title.startsWith("Team") ? "chains" : t.title.startsWith("Goal step ") ? "goals" : "agents";
    const tools = [...new Set((t.trace ?? []).map((s) => s.step).filter((s) => !INNER.has(s)))];
    const acts = (t.pending ?? []).map((p) => `${p.tool} ${p.status}`);
    const detail = [t.agent, tools.length ? `tools: ${tools.join(", ")}` : "", acts.length ? `approvals: ${acts.join(", ")}` : "", t.error ? cut(t.error, 160) : ""].filter(Boolean).join(" · ");
    return { at: t.finished_at ?? t.started_at ?? t.created_at, area, title: `${STATUS[t.status] ?? t.status}: ${t.title}`, detail, link: { task: t.id } };
  });
}

/** Each goal's own log (step done, waiting, blocked, paused …). */
export function goalItems(rows: { doc: { title: string; log?: { at: string; text: string }[] } }[]): ActItem[] {
  return rows.flatMap((r) => (r.doc.log ?? []).map((l) => ({ at: l.at, area: "goals" as const, title: `${r.doc.title}: ${l.text}`, link: { panel: "agents" } })));
}

type JobLike = { source: string; clips: { title: string; publish?: { status: string; at: string; title?: string; scheduledFor?: string; error?: string } }[] };
const PUB: Record<string, string> = { uploading: "Uploading", done: "Published", scheduled: "Scheduled", failed: "Upload failed", unknown: "Upload unclear" };

/** Clip uploads to YouTube (published / scheduled / failed), from the clip jobs' own publish records. */
export function clipItems(jobs: JobLike[]): ActItem[] {
  return jobs.flatMap((j) => j.clips.filter((c) => c.publish?.at).map((c) => {
    const p = c.publish!;
    return { at: p.at, area: "clips" as const, title: `${PUB[p.status] ?? p.status}: ${p.title ?? c.title}`,
      detail: [p.scheduledFor ? `goes live ${p.scheduledFor}` : "", p.error ? cut(p.error, 160) : "", j.source].filter(Boolean).join(" · "), link: { panel: "studio" } };
  }));
}

/** Videos the autopilot started clipping (auto-picked or the owner's pick). */
export function autopilotItems(tracked: { title: string; channel: string; at: string; auto: boolean }[]): ActItem[] {
  return tracked.map((t) => ({ at: t.at, area: "autopilot" as const, title: `Autopilot clipped "${t.title}"`, detail: `${t.channel} · ${t.auto ? "auto-picked" : "your pick"}`, link: { panel: "studio" } }));
}

/** Untrusted undo payload (stored line or POST body) → a valid one, or undefined. */
export function cleanUndo(u: unknown): ActUndo | undefined {
  if (!u || typeof u !== "object") return undefined;
  const { kind, id, to } = u as Record<string, unknown>;
  if (typeof id !== "string" || !id.trim() || id.length > 300) return undefined;
  if (kind === "memory" && /^[\w-]{1,64}$/.test(id)) return { kind, id };
  if (kind === "vault-rename" && typeof to === "string" && to.trim() && to.length <= 300) return { kind, id, to };
  return undefined;
}
export const undoKey = (u: ActUndo) => `${u.kind}:${u.id}${u.kind === "vault-rename" ? `>${u.to}` : ""}`;
/** CORE write → its undo (only save_memory's own "Saved memory … [m:<id>]" receipt; duplicates saved nothing). */
export const undoOf = (tool: string, out: string): { undo?: ActUndo } => {
  const id = tool === "save_memory" && out.startsWith("Saved memory") ? out.match(/\[m:([\w-]{1,64})\]/)?.[1] : undefined;
  return id ? { undo: { kind: "memory", id } } : {};
};
/** Items with Undo still offered: drops the undo of anything a later "undid" line already reversed. */
export function withOpenUndo(items: ActItem[]): ActItem[] {
  const done = new Set(items.flatMap((x) => (x.undid ? [x.undid] : [])));
  return items.map((x) => (x.undo && done.has(undoKey(x.undo)) ? (({ undo: _u, ...rest }) => rest)(x) : x));
}
