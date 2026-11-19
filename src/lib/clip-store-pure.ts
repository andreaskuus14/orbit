// Roadmap 20: a clipped tool result is a recoverable boundary, not silent loss. The full text stays in a per-turn store
// (one per CORE turn, dropped with it) and the model gets the head plus a read_more pointer to fetch the rest.
// Round 3 step 4: ~30 KB per result (was 7,800), so a page or a stylesheet is read whole far more often; the rest pages on.
export const CLIP = 30_000; // under STEP_CHARS (the step slice in core.ts / core-sdk-pure), so the pointer survives it
export const STEP_CHARS = 32_000;

export function createClipStore(limit = CLIP) {
  const full = new Map<string, string>();
  const pointer = (ref: string, offset: number, total: number) =>
    `\n…[${total - offset} chars omitted; call read_more {"ref":"${ref}","offset":${offset}} to read on]`;
  return {
    /** text as-is when it fits; else its first `limit` chars + a pointer to the rest. */
    clip(text: string): string {
      if (text.length <= limit) return text;
      const ref = `r${full.size + 1}`;
      full.set(ref, text);
      return text.slice(0, limit) + pointer(ref, limit, text.length);
    },
    /** read_more {ref, offset}: the next `limit` chars from offset, with a pointer when more remains. */
    read(input: Record<string, unknown>): string {
      const ref = typeof input.ref === "string" ? input.ref : "";
      const text = full.get(ref);
      if (text === undefined) return `Error: unknown ref "${ref}" (refs only last for this answer or task tree)`;
      const offset = Math.max(0, Math.floor(Number(input.offset) || 0));
      if (offset >= text.length) return `Error: offset past the end (${text.length} chars)`;
      const end = offset + limit;
      return text.slice(offset, end) + (end < text.length ? pointer(ref, end, text.length) : "\n[end of result]");
    },
  };
}
