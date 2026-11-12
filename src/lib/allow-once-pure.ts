// "Allow once" for egress refusals (policy-pure decide() egress: true). Pure, tested in tests/allow-once.test.ts.
import { createHash, randomUUID } from "node:crypto";

// "Allow once" (owner request 2026-11-12): on an egress refusal card the owner's click lets exactly that call through one time.
// Bound to sha256(target tool + its exact arguments) and the chat; single use; 10 minutes. Only the requireUser route can grant
// (no CORE tool does), and core.ts uses one only in a foreground turn (never background, scheduler or Auto).
export const ALLOW_ONCE_MS = 10 * 60_000;
const stable = (v: unknown): string => Array.isArray(v) ? `[${v.map(stable).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v ?? null);
export const egressKey = (tool: string, input: unknown) => createHash("sha256").update(`${tool}\n${stable(input ?? {})}`).digest("hex");
type Offer = { key: string; tool: string; chat: string; journal: boolean; at: number };
export function allowOnceBook() {
  const offers = new Map<string, Offer>(), grants = new Map<string, number>();
  const sweep = (now: number) => { for (const [k, o] of offers) if (now - o.at > ALLOW_ONCE_MS) offers.delete(k); for (const [k, t] of grants) if (now > t) grants.delete(k); };
  return {
    /** a refusal card: returns the id the card's button sends (the key and the text stay on the server) */
    offer(tool: string, input: unknown, chat: string, journal: boolean, now = Date.now()) { sweep(now); const id = randomUUID(); offers.set(id, { key: egressKey(tool, input), tool, chat, journal, at: now }); return id; },
    /** the owner's click (route only): the offer becomes a single-use grant for the next 10 minutes */
    grant(id: string, now = Date.now()): { tool: string; journal: boolean } | null {
      sweep(now); const o = offers.get(id); if (!o) return null;
      offers.delete(id); grants.set(`${o.chat}\n${o.key}`, now + ALLOW_ONCE_MS); return { tool: o.tool, journal: o.journal };
    },
    has: (tool: string, input: unknown, chat: string, now = Date.now()) => (sweep(now), grants.has(`${chat}\n${egressKey(tool, input)}`)),
    /** core.ts at the refused call: true once if he allowed exactly this tool + arguments in this chat */
    take(tool: string, input: unknown, chat: string, now = Date.now()) { sweep(now); const k = `${chat}\n${egressKey(tool, input)}`; return grants.delete(k); },
  };
}
export type AllowOnceBook = ReturnType<typeof allowOnceBook>;
/** Activity target of an allowed call: the plugin's server, or the tool itself. */
export const egressTarget = (tool: string) => tool.startsWith("plugin__") ? tool.split("__")[1] ?? tool : tool;
