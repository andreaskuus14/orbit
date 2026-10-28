// One execution-time gate for consequential actions (roadmap 9.1/9.2/7.4): every action with outside effects declares its
// side-effect class here, and the executor refuses outward-send/spend/publish/sign unless the owner's approval carries the hash
// of the exact content that is about to leave. Changed content = different hash = fresh approval. Client-safe (no node imports).
export type Effect = "read" | "reversible" | "outward-send" | "spend" | "publish" | "sign";
export const CONSEQUENTIAL: readonly Effect[] = ["outward-send", "spend", "publish", "sign"];

/** Side-effect class of every CORE tool (policy-pure TIERS) and every owner-click action (policy-pure UI_APPROVALS + other send paths). */
export const EFFECTS: Record<string, Effect> = {
  // CORE tools: reads (own data + public web)
  navigate: "read", goal_status: "read", business_status: "read", ideas_list: "read", studio_status: "read", learned: "read", suggestions: "read",
  life_status: "read", life_journal: "read", vault_search: "read", vault_read: "read", calendar_events: "read", git_summary: "read",
  plan_day: "read", mission_status: "read", start_mission: "reversible", // missions: steps run as agent tasks; outward actions still need approval
  ws_list: "read", ws_read: "read", rea_status: "read", rea_read: "read", week_review: "read", wishlist: "read",
  load_module: "read", web_search: "read", fetch_url: "read", read_news: "read", reach_trending: "read", reach_read: "read",
  // CORE tools: changes to his own data only
  save_memory: "reversible", ask_agent: "reversible", create_goal: "reversible", plan_task: "reversible", run_scout: "reversible", run_niche: "reversible",
  add_wish: "reversible", propose_rule: "reversible", queue_tonight: "reversible", life_check: "reversible", life_add_habit: "reversible", life_remind: "reversible",
  ws_write: "reversible", ws_create: "reversible", rea_analyze: "reversible", rea_cancel: "reversible",
  higgsfield_draft: "reversible", // quote only; the spend is story.approve
  schedule_approved: "publish", // uploads only clips already approved by his click (status "approved")
  // owner-click actions
  "business.send": "outward-send", "contracts.send": "outward-send", "negotiator.approve": "outward-send", "invoices.remind": "outward-send",
  "story.approve": "spend", "studio.schedule": "publish", "studio.publish": "publish", "contracts.sign": "sign",
  "rules.add": "reversible", "rules.confirm": "reversible", "rules.pause": "reversible", "rules.resume": "reversible", "rules.delete": "reversible", "rules.run": "reversible", // standing rules run only existing runners; outward steps still wait in Approvals
  "loops.close": "reversible", "loops.snooze": "reversible", "loops.task": "reversible", // open loops: his own bookkeeping (task = his day plan)
  "memory.hygiene": "reversible", add_task: "reversible", // his accept on a memory merge/retract; an agent's follow-up task (trust-pure history)
  "court.run": "read", "court.keep": "reversible", "twin.argue": "read", "twin.mute": "reversible", // model calls on his own data; keep = a memory
};

export const isConsequential = (action: string) => CONSEQUENTIAL.includes(EFFECTS[action] ?? "sign"); // unknown = fail closed

/** sha256 hex of the exact outgoing content (stable key order is the caller's: pass the same object shape both sides). */
export async function contentHash(content: unknown): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(content)));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

// The exact content each approval covers (both sides build it the same way; business/contracts have their own in their -pure files).
/** Higgsfield spend: the script+options fingerprint the quote priced and the credits he approves. */
export const spendContent = (fingerprint: string, credits: number) => ({ fingerprint, credits });
/** Negotiator reply: the draft text and who approving emails it to (null = he copies it himself). A changed recipient needs a fresh approval. */
export const negoContent = (id: string, text: string, to: string | null) => ({ id, text, to: to ? to.trim().toLowerCase() : null });
/** Clip publish: the media he approved (video, thumbnail, cut). The title/description come from the publish click itself. */
export const clipContent = (c: { video?: string; thumb?: string; start: number; end: number }) => ({ video: c.video ?? "", thumb: c.thumb ?? "", start: c.start, end: c.end });

/** "" when `action` may run with `content`; otherwise why not. `approved` is the hash the owner's click carried. */
export async function approvalGate(action: string, approved: unknown, content: unknown): Promise<string> {
  if (!(action in EFFECTS)) return `unknown action "${action}"`;
  if (!isConsequential(action)) return "";
  if (typeof approved !== "string" || !approved) return "Needs your approval of this exact version: reload and read it first";
  return approved === (await contentHash(content)) ? "" : "The content changed since you approved it: reload and read it again";
}
