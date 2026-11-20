// Embedding provider choice and shaping (pure, tested in tests/embeddings.test.ts).
export const DIM = 1024; // the DB column; EmbeddingGemma gives 768, zero-padding keeps cosine similarity unchanged
export type Provider = "local" | "voyage";

/** ORBIT_EMBED wins; otherwise Voyage when a key is set (its stored vectors stay comparable), else the free local model.
 *  A journal entry is always embedded locally: journal text never leaves ORBIT (AGENTS.md rule 6). */
export function provider(env: { ORBIT_EMBED?: string; VOYAGE_API_KEY?: string }, kind?: string): Provider {
  if (kind === "journal") return "local";
  if (env.ORBIT_EMBED === "local" || env.ORBIT_EMBED === "voyage") return env.ORBIT_EMBED === "voyage" && !env.VOYAGE_API_KEY ? "local" : env.ORBIT_EMBED;
  return env.VOYAGE_API_KEY ? "voyage" : "local";
}
/** Journal vectors (always local) share a space with the others only when everything else is local too. Vectors from two
 *  different models are never compared: with Voyage on, journals are found by keyword only. */
export const journalsComparable = (env: { ORBIT_EMBED?: string; VOYAGE_API_KEY?: string }) => provider(env) === provider(env, "journal");

/** EmbeddingGemma's task prompts (its model card): queries and documents are embedded differently. */
export const gemmaInput = (text: string, kind: "document" | "query") =>
  kind === "query" ? `task: search result | query: ${text}` : `title: none | text: ${text}`;

export function padTo(vec: ArrayLike<number>, dim = DIM): number[] | null {
  if (!vec || vec.length === 0 || vec.length > dim) return null;
  const out = Array.from(vec);
  if (!out.every(Number.isFinite)) return null;
  while (out.length < dim) out.push(0);
  return out;
}

/** Documents longer than this are embedded in chunks (EmbeddingGemma's window is ~2k tokens, ~8k chars). */
export const CHUNK_AT = 8_000;
export const CHUNK_SIZE = 6_000;
export const MAX_CHUNKS = 12; // 72k chars; the rest is dropped so a huge paste can't stall a save

/** Split long text into <= CHUNK_SIZE pieces on paragraph, line, then sentence boundaries (hard cut as last resort). Short text = one piece. */
export function chunkText(text: string, size = CHUNK_SIZE, max = MAX_CHUNKS): string[] {
  if (text.length <= CHUNK_AT) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > size && out.length < max) {
    const win = rest.slice(0, size);
    // best boundary in the back half of the window: paragraph, else line, else sentence, else a hard cut
    const at = (i: number, w: number) => (i >= size * 0.5 ? i + w : 0);
    const cut = at(win.lastIndexOf("\n\n"), 2) || at(win.lastIndexOf("\n"), 1) || at(win.lastIndexOf(". "), 2) || size;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut);
  }
  if (rest.trim() && out.length < max) out.push(rest.trim());
  return out.filter(Boolean);
}

/** One vector for a chunked document: the normalized mean of its chunk vectors (all unit-length), so a fact in any chunk pulls the document toward it. */
export function meanVector(vecs: ArrayLike<number>[]): number[] | null {
  if (!vecs.length) return null;
  const n = vecs[0].length;
  if (!n || vecs.some((v) => v.length !== n)) return null;
  const sum = new Array<number>(n).fill(0);
  for (const v of vecs) for (let i = 0; i < n; i++) sum[i] += v[i];
  const norm = Math.hypot(...sum);
  return norm > 0 && Number.isFinite(norm) ? sum.map((x) => x / norm) : null;
}
