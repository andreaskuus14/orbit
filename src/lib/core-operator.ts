// CORE operator tools, IO side (rules and parsing: core-operator-pure.ts). Every successful write saves its before-state in
// <ORBIT data dir>/operator-undo.json and returns "[op:<id>]"; core.ts logs it to OPERATIONS → Activity with that Undo, and
// POST /api/activity runs undoOp(). Records only: nothing here drafts, sends, publishes or spends, and the journal is never read.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir.ts";
import { automationInput, keepSnaps, leadChange, leadNotes, newOpId, OP_ID, opsBlocked, pickByName, receipt, tallinnTimes, type OpsSnap, type OpsTool } from "./core-operator-pure.ts";
import type { DayPlan } from "./dayplan-pure.ts";

/** agentOk: tests pass their own (agents.ts can't load under node --test). */
type Ctx = { sb: SupabaseClient; userId: string; question: string; tainted: boolean; operator?: boolean; agentOk?: (slug: string) => Promise<boolean> };
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const FILE = () => path.join(orbitDataDir(), "operator-undo.json");
const g = globalThis as unknown as { __orbitOps?: Promise<unknown> };
const load = async (): Promise<Record<string, OpsSnap>> => { try { const j = JSON.parse(await readFile(FILE(), "utf8")); return j && typeof j === "object" && !Array.isArray(j) ? j : {}; } catch { return {}; } };
function updateSnaps<T>(fn: (s: Record<string, OpsSnap>) => { store: Record<string, OpsSnap>; out: T }): Promise<T> {
  const p = (g.__orbitOps ?? Promise.resolve()).catch(() => {}).then(async () => {
    const { store, out } = fn(await load());
    await mkdir(path.dirname(FILE()), { recursive: true });
    await writeFile(FILE() + ".tmp", JSON.stringify(store));
    await rename(FILE() + ".tmp", FILE());
    return out;
  });
  g.__orbitOps = p;
  return p;
}
/** Save what Undo puts back; the receipt goes at the end of the tool's first line (core.ts logs that line). */
const snap = async (tool: OpsTool, data: Record<string, unknown>) => {
  const id = newOpId();
  await updateSnaps((s) => ({ store: keepSnaps(s, id, { tool, at: new Date().toISOString(), data }), out: null }));
  return receipt(id);
};

export async function runOpsTool(tool: OpsTool, input: Record<string, unknown>, c: Ctx): Promise<string> {
  const blocked = c.operator ? null : opsBlocked(tool, c.question, c.tainted, input); // standing grant: decide() already passed it
  if (blocked) return `Error: ${blocked}`;
  try {
    switch (tool) {
      case "vault_rename": {
        const from = str(input.name, 300), to = str(input.to, 300);
        if (!from || !to) return "Error: name and to are required";
        const v = await import("./vault.ts");
        const name = await v.renameFile(from, to, await v.cloudOnlyNames(c.sb, c.userId));
        if (name === from) return `Nothing to do: "${from}" already has that name.`;
        const cloud = await v.cloudMove(c.sb, c.userId, from, name);
        return `Done: VAULT "${from}" renamed to "${name}" ${await snap(tool, { from, name })}${cloud === "ok" ? "" : `\n(cloud copy: ${cloud})`}`;
      }
      case "vault_move": {
        const name = str(input.name, 300);
        if (!name) return "Error: name is required";
        if (str(input.to, 20).toLowerCase() !== "trash") return 'Error: VAULT files are flat: the only place to move one is "trash" (use vault_rename to rename)';
        const v = await import("./vault.ts");
        const t = await v.deleteFile(name);
        await v.cloudRemove(c.sb, c.userId, t.name);
        return `Done: VAULT "${t.name}" moved to the VAULT trash (restorable for 30 days) ${await snap(tool, { trash: t.id, name: t.name })}`;
      }
      case "lead_update": {
        const { STAGES, validatePatch } = await import("./business-pure.ts");
        const ch = leadChange(input, STAGES);
        if (typeof ch === "string") return `Error: ${ch}`;
        const rows = ((await c.sb.from("prospects").select("id,name,contact,notes,stage").limit(500)).data ?? []) as { id: string; name: string; contact: string; notes: string; stage: string }[];
        const p = pickByName(rows, str(input.lead, 120), "lead");
        if (typeof p === "string") return `Error: ${p}`;
        const notes = leadNotes(p.notes ?? "", ch.note, ch.next);
        const patch = validatePatch({ ...(ch.stage && ch.stage !== p.stage ? { stage: ch.stage } : {}), ...(notes !== (p.notes ?? "") ? { notes } : {}) });
        if (typeof patch === "string" && patch !== "Nothing to change") return `Error: ${patch}`;
        if (notes.length > 2000) return "Error: notes would pass 2000 characters; shorten the note";
        const crm = await import("./prospect-crm.ts");
        const before = crm.crmOf(await crm.loadCrm(), p), was = { id: p.id, stage: p.stage, notes: p.notes ?? "" };
        if (typeof patch !== "string") {
          const { error } = await c.sb.from("prospects").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", p.id);
          if (error) return `Error: ${error.message}`;
          if (patch.stage) await crm.logEvent(p, "stage", patch.stage);
        }
        if (typeof patch === "string" && (ch.verified === undefined || ch.verified === before.verified)) return `Nothing to do: lead "${p.name}" already looks like that.`;
        if (ch.verified !== undefined && ch.verified !== before.verified)
          await crm.updateCrm((s) => { s[p.id] = { ...crm.crmOf(s, p), verified: ch.verified!, verifiedAt: ch.verified ? new Date().toISOString() : undefined }; });
        const what = [typeof patch !== "string" && patch.stage ? `stage ${patch.stage}` : "", ch.next ? "next action" : "", ch.note ? "note" : "", ch.verified !== undefined ? (ch.verified ? "contact verified" : "contact unverified") : ""].filter(Boolean);
        return `Done: lead "${p.name}" updated (${what.join(", ")}) ${await snap(tool, { ...was, afterNotes: notes, verified: before.verified, verifiedAt: before.verifiedAt ?? null })}`;
      }
      case "life_plan": {
        const dp = await import("./dayplan.ts");
        const { localDay } = await import("./morning-pure.ts");
        if ((await dp.currentPlan())?.day !== localDay(new Date())) await dp.planDay(c.sb, c.userId); // no plan for today yet: build the proposal first
        const cur = (await dp.currentPlan())!; // Undo puts this back
        const action = str(input.action, 10).toLowerCase();
        if (action === "accept") {
          if (cur.accepted) return "Nothing to do: today's plan is already accepted.";
          const r = await dp.accept();
          if (typeof r === "string") return `Error: ${r}`;
        } else if (action === "adjust") {
          const b = pickByName(cur.blocks.map((x) => ({ ...x, name: x.title })), str(input.block, 120), "plan block");
          if (typeof b === "string") return `Error: ${b}`;
          const r = await dp.adjust(b.id, Math.round(Number(input.minutes)));
          if (typeof r === "string") return `Error: ${r}`;
        } else return 'Error: action must be "accept" or "adjust"';
        const after = (await dp.currentPlan())!;
        return `Done: today's plan ${action === "accept" ? "accepted" : "adjusted"} ${await snap(tool, { before: cur, after })}\n${(await import("./dayplan-pure.ts")).planText(after)}`;
      }
      case "automation_create": {
        const d = automationInput(input);
        if (typeof d === "string") return `Error: ${d}`;
        const [{ automationSpec }, { validateAutomation, describeTrigger }, { nextOccurrences }] = await Promise.all([import("./automation-edit-pure.ts"), import("./pure.ts"), import("./automation-preview-pure.ts")]);
        const v = validateAutomation(automationSpec(d));
        if ("error" in v) return `Error: ${v.error}`;
        const agentOk = c.agentOk ?? (async (slug: string) => !!(await (await import("./agents")).getAgent(c.sb, slug, c.userId)));
        if (!(await agentOk(v.spec.agent))) return `Error: unknown agent "${v.spec.agent}"`;
        const { data, error } = await c.sb.from("automations").insert({ ...v.spec, user_id: c.userId }).select("id").single();
        if (error) return `Error: ${error.message}`;
        const next = v.spec.schedule ? tallinnTimes(nextOccurrences(v.spec.schedule, new Date(), 3)) : [];
        return `Done: automation "${v.spec.name}" created (${describeTrigger(v.spec)}, agent ${v.spec.agent}) ${await snap(tool, { id: data.id })}\n${next.length ? `Next runs (Europe/Tallinn): ${next.join("; ")}` : "Runs on that event."} Anything it would send, publish or spend still waits for his approval. Pause or edit it in Agents → Automations.`;
      }
      case "automation_pause": {
        const rows = ((await c.sb.from("automations").select("id,name,enabled").eq("user_id", c.userId)).data ?? []) as { id: string; name: string; enabled: boolean }[];
        const a = pickByName(rows, str(input.automation, 100), "automation");
        if (typeof a === "string") return `Error: ${a}`;
        const enabled = input.paused === false;
        if (a.enabled === enabled) return `Nothing to do: "${a.name}" is already ${enabled ? "running" : "paused"}.`;
        const was = { id: a.id, enabled: a.enabled };
        const { error } = await c.sb.from("automations").update({ enabled }).eq("id", a.id).eq("user_id", c.userId);
        if (error) return `Error: ${error.message}`;
        return `Done: automation "${a.name}" ${enabled ? "resumed" : "paused"} ${await snap(tool, was)}`;
      }
    }
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Undo one operator write (POST /api/activity). Returns the Activity line, or throws with a message for the owner. */
export async function undoOp(sb: SupabaseClient, userId: string, id: string): Promise<string> {
  if (!OP_ID.test(id)) throw new Error("Unknown undo");
  const s = (await load())[id];
  if (!s) throw new Error("Nothing to undo (too old or already undone)");
  const d = s.data as Record<string, never>;
  let line: string;
  switch (s.tool) {
    case "vault_rename": {
      const v = await import("./vault.ts");
      const name = await v.renameFile(d.name, d.from, await v.cloudOnlyNames(sb, userId));
      if (name !== d.name) await v.cloudMove(sb, userId, d.name, name);
      line = `Undone: VAULT "${d.name}" renamed back to "${name}"`;
      break;
    }
    case "vault_move": {
      const v = await import("./vault.ts");
      const name = await v.restoreTrash(d.trash, await v.cloudOnlyNames(sb, userId));
      await v.cloudPut(sb, userId, name);
      line = `Undone: VAULT "${name}" back from the trash`;
      break;
    }
    case "lead_update": {
      const { data: p } = await sb.from("prospects").select("id,name,contact,notes,stage").eq("id", d.id).maybeSingle();
      if (!p) throw new Error("That lead is gone");
      if ((p.notes ?? "") !== d.afterNotes) throw new Error("The lead's notes changed since; edit it in BUSINESS");
      const { error } = await sb.from("prospects").update({ stage: d.stage, notes: d.notes, updated_at: new Date().toISOString() }).eq("id", d.id);
      if (error) throw new Error(error.message);
      const crm = await import("./prospect-crm.ts");
      if (p.stage !== d.stage) await crm.logEvent(p, "stage", d.stage);
      await crm.updateCrm((st) => { st[p.id] = { ...crm.crmOf(st, p), verified: d.verified, verifiedAt: d.verifiedAt ?? undefined }; });
      line = `Undone: lead "${p.name}" put back`;
      break;
    }
    case "life_plan": {
      const r = await (await import("./dayplan.ts")).restorePlan(d.before as DayPlan | null, d.after as DayPlan);
      if (r) throw new Error(r);
      line = "Undone: today's plan put back";
      break;
    }
    case "automation_create": {
      const { data, error } = await sb.from("automations").delete().eq("id", d.id).eq("user_id", userId).select("id");
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error("That automation is already gone");
      line = "Undone: automation deleted";
      break;
    }
    case "automation_pause": {
      const { data, error } = await sb.from("automations").update({ enabled: d.enabled }).eq("id", d.id).eq("user_id", userId).select("name");
      if (error) throw new Error(error.message);
      if (!data?.length) throw new Error("That automation is gone");
      line = `Undone: automation "${data[0].name}" ${d.enabled ? "resumed" : "paused"} again`;
      break;
    }
    default: throw new Error("Unknown undo");
  }
  await updateSnaps((st) => { const { [id]: _gone, ...rest } = st; return { store: rest, out: null }; });
  return line;
}
