// BUSINESS planet state: one GET /api/business shared by the shell and every sheet, patched in place after an action
// instead of reloading everything (tested in tests/business-state.test.ts).
import { funnel, STAGES, type Prospect, type Stage } from "./business-pure.ts";
import type { Crm, LostReason } from "./prospect-crm-pure.ts";

export type Funnel = { counts: Record<Stage, number>; monthly: number; total: number };
export type BizState = { prospects: Prospect[]; funnel: Funnel; canSend?: boolean; nightDrafts?: string[] };

/** Actions whose reply is the saved prospect row (no crm/touch): merge it in and keep what the server attached on GET. */
const ROW_ACTIONS = new Set(["add", "update", "draft", "followup", "research"]);

const withFunnel = (s: BizState, prospects: Prospect[]): BizState => ({ ...s, prospects, funnel: funnel(prospects) as Funnel });

/**
 * The new state after a successful POST, or null when only a fresh GET can know (send, unknown replies).
 * `at` is the time the action happened (for a logged CRM event).
 */
export function applyAction(s: BizState, body: { action?: unknown; id?: unknown; kind?: unknown; text?: unknown; reason?: unknown }, reply: unknown, at: string): BizState | null {
  const action = String(body.action ?? ""), id = typeof body.id === "string" ? body.id : "";
  const row = reply && typeof reply === "object" && typeof (reply as Prospect).id === "string" && typeof (reply as Prospect).name === "string" ? (reply as Prospect) : null;
  if (ROW_ACTIONS.has(action)) {
    if (!row || !STAGES.includes(row.stage)) return null;
    const old = s.prospects.find((p) => p.id === row.id);
    const merged: Prospect = { ...row, fee: Number(row.fee) || 0, crm: old?.crm, touch: old?.touch ?? null };
    if (old && action === "update" && row.stage !== old.stage && merged.crm) merged.crm = { ...merged.crm, events: [...(merged.crm.events ?? []), { at, kind: "stage", text: row.stage }] };
    const list = old ? s.prospects.map((p) => (p.id === row.id ? merged : p)) : [merged, ...s.prospects];
    const nightDrafts = action === "followup" ? (s.nightDrafts ?? []).filter((x) => x !== row.id) : s.nightDrafts;
    return { ...withFunnel(s, list), nightDrafts };
  }
  const p = s.prospects.find((x) => x.id === id);
  if (!p) return null;
  if (action === "delete") return withFunnel(s, s.prospects.filter((x) => x.id !== id));
  const crm = p.crm;
  if (!crm) return null; // no CRM record attached yet: the server makes one
  const patch = (np: Prospect) => withFunnel(s, s.prospects.map((x) => (x.id === id ? np : x)));
  switch (action) {
    case "verify": return patch({ ...p, crm: { ...crm, verified: true } });
    case "lost": return patch({ ...p, crm: { ...crm, lost: body.reason ? { reason: body.reason as LostReason, at } : undefined } });
    case "log": {
      const ev = { at, kind: String(body.kind), ...(typeof body.text === "string" && body.text.trim() && { text: body.text.trim() }) };
      return patch({ ...p, crm: { ...crm, events: [...crm.events, ev as Crm["events"][number]] }, touch: { last: at, replied: (p.touch?.replied ?? false) || body.kind === "reply" } });
    }
    default: return null; // send and anything new: ask the server
  }
}

/** Results line: what the work has led to so far. */
export function bizResults(s: BizState) {
  const c = s.funnel.counts;
  return { open: s.funnel.total - c.lost, replied: c.replied, pilots: c.pilot, paying: c.paying, monthly: s.funnel.monthly };
}
