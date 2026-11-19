// ws_edit (Round 3): change part of a workspace file by exact text, like Claude Code's Edit, instead of rewriting the whole file.
// Live 19 Nov: CORE left a one-colour fix in an 11 KB stylesheet undone rather than rewrite the file blind.

export type WsEdit = { old: string; new: string };

/** Each edit's `old` must occur exactly once in the current text (after the edits before it); returns the new text or an error. */
export function applyEdits(text: string, raw: unknown): { text: string } | { error: string } {
  const list = typeof raw === "string" ? (() => { try { return JSON.parse(raw) as unknown; } catch { return null; } })() : raw;
  if (!Array.isArray(list) || !list.length || list.length > 20) return { error: "edits must be a list of 1-20 {old, new}" };
  let out = text;
  for (const [i, e] of (list as Partial<WsEdit>[]).entries()) {
    if (!e || typeof e.old !== "string" || typeof e.new !== "string" || !e.old) return { error: `edit ${i + 1}: needs a non-empty "old" and a "new" text` };
    const at = out.indexOf(e.old);
    if (at < 0) return { error: `edit ${i + 1}: "old" text not found (read the file again with ws_read and copy it exactly)` };
    if (out.indexOf(e.old, at + 1) >= 0) return { error: `edit ${i + 1}: "old" text occurs more than once; include more surrounding text so it is unique` };
    out = out.slice(0, at) + e.new + out.slice(at + e.old.length);
  }
  return out === text ? { error: "the edits change nothing" } : { text: out };
}
