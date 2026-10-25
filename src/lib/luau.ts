import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude, recordUsage, SMART_MODEL, FAST_MODEL } from "./claude";
import { buildLuauPrompt, parseLuauReply, lintLuau, diffLines, luauSourceText, LUAU_SYSTEM, EXPLAIN_SYSTEM, type LuauRequest, type DiffLine, type LintFlag } from "./luau-pure";
import { fetchDocPages, lookupApi } from "./roblox-docs";
import { checkAgainstPages, docsBlock, extractApiNames, pageNames, validateApiUse } from "./roblox-docs-pure";

export type LuauResult =
  | { mode: "explain"; text: string }
  | { mode: "write" | "fix"; code: string; notes: string[]; flags: LintFlag[]; diff: DiffLine[] | null; sources: { name: string; url: string }[] };

/** One Luau helper call: smart model for Write/Fix, fast for Explain. Tools are disabled inside askClaude.
 *  Roblox API docs for the APIs the input mentions go into the prompt; afterwards the code's API use is checked against the docs YAML and the create.roblox.com pages (cited in `sources`). */
export async function runLuau(sb: SupabaseClient, userId: string, r: LuauRequest, signal?: AbortSignal): Promise<LuauResult> {
  const model = r.mode === "explain" ? FAST_MODEL : SMART_MODEL;
  const names = extractApiNames(luauSourceText(r));
  const docs = docsBlock(names, await lookupApi(names));
  const res = await askClaude(buildLuauPrompt(r, docs), r.mode === "explain" ? EXPLAIN_SYSTEM : LUAU_SYSTEM, { lane: "foreground", signal, model });
  void recordUsage(sb, userId, "luau.helper", res, model);
  if (r.mode === "explain") return { mode: "explain", text: res.text };
  const { code, notes } = parseLuauReply(res.text);
  if (!code.trim()) throw new Error("The model returned no code. Try rephrasing.");
  const refs = await lookupApi(extractApiNames(code, 16), { chain: true, timeoutMs: 6000 });
  const api = validateApiUse(code, refs);
  // Before it's shown: the code's method calls are checked against the create.roblox.com pages actually fetched, which are cited.
  const page = checkAgainstPages(code, await fetchDocPages(pageNames(code, Object.keys(refs))));
  return { mode: r.mode, code, notes, flags: [...lintLuau(code, r.kind), ...api, ...page.flags], diff: diffLines(r.mode === "fix" ? r.code : "", code), sources: page.sources };
}
