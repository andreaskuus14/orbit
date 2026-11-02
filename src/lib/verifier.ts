// Independent verifier call (pure parts and the why: verifier-pure.ts). One cheap `claude -p` with every tool off (it only reads
// the evidence in its prompt), time-capped, skipped under Stop-all or ORBIT_VERIFY=off. Never throws: a failed call is no verdict.
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude, recordUsage, FAST_MODEL } from "./claude";
import { stopAllOn } from "./stop-all";
import { coreReceipt } from "./receipt-pure";
import type { CoreEvalTool } from "./core-answer-eval-pure";
import { needsVerify, parseVerdict, verifierPrompt, VERIFIER_SYSTEM, type Verdict } from "./verifier-pure";

const MODEL = process.env.ORBIT_MODEL_VERIFY || FAST_MODEL;
const CAP_MS = 60_000;

export async function verifyTurn(v: { sb: SupabaseClient; userId: string; question: string; answer: string; tools: readonly CoreEvalTool[]; signal?: AbortSignal; timeLeftMs?: number }): Promise<(Verdict & { ms: number }) | null> {
  if (process.env.ORBIT_VERIFY === "off" || stopAllOn() || v.signal?.aborted) return null;
  const receipt = coreReceipt(v.question, v.tools);
  if (!receipt || !needsVerify(v.question, receipt, v.tools)) return null;
  const timeoutMs = Math.min(CAP_MS, (v.timeLeftMs ?? CAP_MS) - 10_000);
  if (timeoutMs < 15_000) return null; // no time left in the turn: the receipt stays the agent's own check
  const t = Date.now();
  try {
    const r = await askClaude(verifierPrompt(v.question, receipt, v.answer, v.tools), VERIFIER_SYSTEM, { lane: "foreground", signal: v.signal, model: MODEL, timeoutMs, purpose: "core.verify" });
    void recordUsage(v.sb, v.userId, "core.verify", r, MODEL).catch(() => {});
    const d = parseVerdict(r.text);
    return d && { ...d, ms: Date.now() - t };
  } catch (e) {
    if (v.signal?.aborted) throw e;
    return null;
  }
}
