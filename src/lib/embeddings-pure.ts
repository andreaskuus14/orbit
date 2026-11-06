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
