// CORE operator tools, IO side (rules and parsing: core-operator-pure.ts). Every successful write saves its before-state in
// <ORBIT data dir>/operator-undo.json and returns "[op:<id>]"; core.ts logs it to OPERATIONS → Activity with that Undo, and
// POST /api/activity runs undoOp(). Records only: nothing here drafts, sends, publishes or spends, and the journal is never read.
import { readStore, writeStore } from "./safe-file.ts";
import { rename } from "node:fs/promises";
import { withEvalNote } from "./eval-run.ts";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orbitDataDir } from "./data-dir.ts";
import { automationInput, createdLeads, keepSnaps, leadChange, leadInputs, leadNotes, newOpId, OP_ID, opsBlocked, ownLeadsIn, pickByName, receipt, rememberOwnLeads, tallinnTimes, type OpsSnap, type OpsTool } from "./core-operator-pure.ts";
import type { DayPlan } from "./dayplan-pure.ts";
import type { PlanSnap } from "./dayplan.ts";

/** agentOk: tests pass their own (agents.ts can't load under node --test). */
type Ctx = { sb: SupabaseClient; userId: string; question: string; tainted: boolean; operator?: boolean; agentOk?: (slug: string) => Promise<boolean>; now?: number; chat?: string; pinned?: boolean; steps?: string[] };
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const FILE = () => path.join(orbitDataDir(), "operator-undo.json");
const g = globalThis as unknown as { __orbitOps?: Promise<unknown> };
const load = async (): Promise<Record<string, OpsSnap>> => { const t = await readStore(FILE()), j = t ? JSON.parse(t) : null; return j && typeof j === "object" && !Array.isArray(j) ? j : {}; }; // locked/damaged throws
function updateSnaps<T>(fn: (s: Record<string, OpsSnap>) => { store: Record<string, OpsSnap>; out: T }): Promise<T> {
  const p = (g.__orbitOps ?? Promise.resolve()).catch(() => {}).then(async () => {
    const { store, out } = fn(await load());
    await writeStore(FILE(), JSON.stringify(store));
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
  const own = c.pinned ? [] : [...createdLeads(c.steps ?? []), ...ownLeadsIn(c.chat)]; // leads CORE added for this task (policy-pure decide has the same rule)
  const blocked = c.operator ? null : opsBlocked(tool, c.question, c.tainted, input, own); // standing grant: decide() already passed it
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
      case "lead_create": {
        const leads = leadInputs(input);
        if (typeof leads === "string") return `Error: ${leads}`;
        const [crm, { duplicateOf, newCrm }] = await Promise.all([import("./prospect-crm.ts"), import("./prospect-crm-pure.ts")]);
        const rows = ((await c.sb.from("prospects").select("id,name,contact").limit(1000)).data ?? []) as { id: string; name: string; contact: string }[];
        const store = await crm.loadCrm(), made: { id: string; notes: string }[] = [], lines: string[] = [];
        for (const l of leads) {
          const dup = duplicateOf(rows, store, l.name, l.contact);
          if (dup) { lines.push(`skipped "${l.name}": already in BUSINESS as "${rows.find((r) => r.id === dup)?.name}" (id ${dup})`); continue; }
          const { data, error } = await c.sb.from("prospects").insert({ ...l, notes: withEvalNote(l.notes), stage: "lead" }).select("id,name,contact,notes").single();
          if (error || !data) { lines.push(`"${l.name}" not added: ${error?.message ?? "no row"}`); continue; }
          rows.push(data); made.push({ id: data.id, notes: l.notes });
          await crm.updateCrm((s) => { s[data.id] = newCrm("web-find", l.name, l.contact); }); // contact unverified until he checks it
          lines.push(`added "${l.name}" (id ${data.id})`);
        }
        if (!made.length) return `Nothing to do: ${lines.join("; ")}`;
        rememberOwnLeads(c.chat, leads.filter((l) => lines.some((x) => x.startsWith(`added "${l.name}" (id `))).map((l) => l.name)); // later turns of this chat may note them
        return `Done: ${made.length} BUSINESS lead${made.length > 1 ? "s" : ""} added at To contact, unverified ${await snap(tool, { made })}\n${lines.join("\n")}\nNothing was drafted or sent.`;
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
        const now = c.now ?? Date.now(), snapBefore = await dp.planSnapshot(); // Undo puts this back (plan, order, prev, history, deferrals)
        if ((await dp.currentPlan())?.day !== localDay(new Date(now))) await dp.planDay(c.sb, c.userId, { now }); // no plan for today yet: build the proposal first
        const cur = (await dp.currentPlan())!;
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
        return `Done: today's plan ${action === "accept" ? "accepted" : "adjusted"} ${await snap(tool, { before: snapBefore, after })}\n${(await import("./dayplan-pure.ts")).planText(after)}`;
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
    case "lead_create": {
      const made = d.made as unknown as { id: string; notes: string }[], crm = await import("./prospect-crm.ts");
      for (const m of made) { // refuse before deleting anything he has worked on since
        const { data: p } = await sb.from("prospects").select("id,name,stage,notes").eq("id", m.id).maybeSingle();
        if (p && (p.stage !== "lead" || (p.notes ?? "") !== m.notes)) throw new Error(`"${p.name}" changed since; remove it in BUSINESS`);
      }
      for (const m of made) {
        const { error } = await sb.from("prospects").delete().eq("id", m.id);
        if (error) throw new Error(error.message);
      }
      await crm.updateCrm((st) => { for (const m of made) delete st[m.id]; });
      line = `Undone: ${made.length} added lead${made.length > 1 ? "s" : ""} deleted`;
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
      const r = await (await import("./dayplan.ts")).restorePlan(d.before as PlanSnap, d.after as DayPlan);
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
