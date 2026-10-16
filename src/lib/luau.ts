import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude, recordUsage, SMART_MODEL, FAST_MODEL } from "./claude";
import { buildLuauPrompt, parseLuauReply, lintLuau, diffLines, LUAU_SYSTEM, EXPLAIN_SYSTEM, type LuauRequest, type DiffLine, type LintFlag } from "./luau-pure";

export type LuauResult =
  | { mode: "explain"; text: string }
  | { mode: "write" | "fix"; code: string; notes: string[]; flags: LintFlag[]; diff: DiffLine[] | null };

/** One Luau helper call: smart model for Write/Fix, fast for Explain. Tools are disabled inside askClaude. */
export async function runLuau(sb: SupabaseClient, userId: string, r: LuauRequest, signal?: AbortSignal): Promise<LuauResult> {
  const model = r.mode === "explain" ? FAST_MODEL : SMART_MODEL;
  const res = await askClaude(buildLuauPrompt(r), r.mode === "explain" ? EXPLAIN_SYSTEM : LUAU_SYSTEM, { lane: "foreground", signal, model });
  void recordUsage(sb, userId, "luau.helper", res, model);
  if (r.mode === "explain") return { mode: "explain", text: res.text };
  const { code, notes } = parseLuauReply(res.text);
  if (!code.trim()) throw new Error("The model returned no code. Try rephrasing.");
  return { mode: r.mode, code, notes, flags: lintLuau(code, r.kind), diff: diffLines(r.mode === "fix" ? r.code : "", code) };
}
