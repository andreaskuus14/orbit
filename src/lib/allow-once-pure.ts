// "Allow once" for egress refusals (policy-pure decide() egress: true). Pure, tested in tests/allow-once.test.ts.
import { createHash, randomUUID } from "node:crypto";

// "Allow once" (owner request 2026-11-12): on an egress refusal card the owner's click lets exactly that call through one time.
// The offer keeps the exact input in memory: the card shows it (GET view) and the grant's hash is taken from that same input.
// Bound to the chat; single use; 10 minutes. Only the requireUser route can grant (no CORE tool does), and core.ts uses one only
// in a foreground turn (never background, scheduler or Auto).
export const ALLOW_ONCE_MS = 10 * 60_000;
const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])])) : v ?? null;
/** The exact arguments as the card shows them: sorted keys, full text. */
export const argsText = (input: unknown) => JSON.stringify(sorted(input ?? {}), null, 2);
export const egressKey = (tool: string, input: unknown) => createHash("sha256").update(`${tool}\n${argsText(input)}`).digest("hex");
/** Activity target of an allowed call: the plugin's server, or the tool itself. */
export const egressTarget = (tool: string) => tool.startsWith("plugin__") ? tool.split("__")[1] ?? tool : tool;
const DEST = /^(?:to|cc|bcc|recipients?|email|address|url|link|href|uri|target|channel|chat|path|file|folder|workspace|agent|host|domain|query)$/i;
/** Where the call goes: the plugin server or tool, plus any recipient / URL / target fields of the input. */
export function destination(tool: string, input: unknown): string {
  const fields = input && typeof input === "object" && !Array.isArray(input)
    ? Object.entries(input as Record<string, unknown>).filter(([k]) => DEST.test(k)).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`) : [];
  return [tool.startsWith("plugin__") ? `plugin ${egressTarget(tool)} (${tool.split("__").slice(2).join("__")})` : tool, ...fields].join(" · ");
}
type Offer = { tool: string; input: unknown; chat: string; journal: boolean; at: number };
export function allowOnceBook() {
  const offers = new Map<string, Offer>(), grants = new Map<string, { exp: number; journal: boolean }>();
  const sweep = (now: number) => { for (const [k, o] of offers) if (now - o.at > ALLOW_ONCE_MS) offers.delete(k); for (const [k, g] of grants) if (now > g.exp) grants.delete(k); };
  const gkey = (chat: string, tool: string, input: unknown) => `${chat}\n${egressKey(tool, input)}`;
  return {
    /** a refusal card: returns the id the card's button sends (the input stays on the server) */
    offer(tool: string, input: unknown, chat: string, journal: boolean, now = Date.now()) { sweep(now); const id = randomUUID(); offers.set(id, { tool, input: structuredClone(input ?? {}), chat, journal, at: now }); return id; },
    /** what the card shows for an offer (route GET, signed-in owner): tool, destination and the exact arguments */
    view(id: string, now = Date.now()) { sweep(now); const o = offers.get(id); return o ? { tool: o.tool, destination: destination(o.tool, o.input), args: argsText(o.input), journal: o.journal } : null; },
    /** the owner's click (route only): the offer's own stored input becomes a single-use grant for the next 10 minutes */
    grant(id: string, now = Date.now()): { tool: string; journal: boolean } | null {
      sweep(now); const o = offers.get(id); if (!o) return null;
      offers.delete(id); grants.set(gkey(o.chat, o.tool, o.input), { exp: now + ALLOW_ONCE_MS, journal: o.journal }); return { tool: o.tool, journal: o.journal };
    },
    has: (tool: string, input: unknown, chat: string, now = Date.now()) => (sweep(now), grants.has(gkey(chat, tool, input))),
    /** core.ts at the refused call: the grant (used up) if he allowed exactly this tool + arguments in this chat, else null */
    take(tool: string, input: unknown, chat: string, now = Date.now()) { sweep(now); const k = gkey(chat, tool, input), g = grants.get(k); grants.delete(k); return g ? { journal: g.journal } : null; },
  };
}
export type AllowOnceBook = ReturnType<typeof allowOnceBook>;
