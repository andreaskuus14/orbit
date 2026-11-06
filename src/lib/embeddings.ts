// Embeddings for memory search, 1024 dims to match the DB column. Two providers (embeddings-pure.ts picks):
// - local (default without a Voyage key): EmbeddingGemma-300M on this PC via transformers.js, q8, ~200 ms each. Free, offline.
// - voyage: the hosted API, kept for existing installs so stored vectors stay comparable until re-embedded (POST /api/memories/reembed).
import { gemmaInput, journalsComparable, padTo, provider } from "./embeddings-pure";

export const embeddingsEnabled = () => true; // the local model is always available; a load failure just returns null below
export const embeddingProvider = () => provider({ ORBIT_EMBED: process.env.ORBIT_EMBED, VOYAGE_API_KEY: process.env.VOYAGE_API_KEY });
export const journalVectorsComparable = () => journalsComparable({ ORBIT_EMBED: process.env.ORBIT_EMBED, VOYAGE_API_KEY: process.env.VOYAGE_API_KEY });

type FE = (s: string, o: { pooling: "mean"; normalize: boolean }) => Promise<{ data: ArrayLike<number> }>;
const G = globalThis as unknown as { __orbitEmbed?: Promise<FE | null> };
const local = () => (G.__orbitEmbed ??= import("@huggingface/transformers")
  .then((tf) => tf.pipeline("feature-extraction", "onnx-community/embeddinggemma-300m-ONNX", { dtype: "q8" }) as unknown as Promise<FE>)
  .catch((e) => { console.error("[orbit] local embedding model failed to load", e); G.__orbitEmbed = undefined; return null; }));

async function voyage(text: string, inputType: "document" | "query"): Promise<number[] | null> {
  const res = await fetch(process.env.VOYAGE_API_URL || "https://ai.mongodb.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.VOYAGE_API_KEY}` },
    body: JSON.stringify({ input: [text], model: process.env.VOYAGE_MODEL || "voyage-4", input_type: inputType }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) { console.error("[orbit] embedding failed", res.status, await res.text().catch(() => "")); return null; }
  const vec = ((await res.json()) as { data?: { embedding: number[] }[] }).data?.[0]?.embedding;
  return vec && vec.length === 1024 ? vec : null;
}

/** `kind` is the memory's kind when embedding a stored memory; a "journal" one never goes to the hosted provider. */
export async function embed(text: string, inputType: "document" | "query", kind?: string): Promise<number[] | null> {
  // shortcut: embeds the first 8k chars only (EmbeddingGemma's window is 2k tokens); chunk long documents when deep document search arrives.
  const t = text.slice(0, 8_000);
  try {
    if (provider({ ORBIT_EMBED: process.env.ORBIT_EMBED, VOYAGE_API_KEY: process.env.VOYAGE_API_KEY }, kind) === "voyage") return await voyage(t, inputType);
    const fe = await local();
    if (!fe) return null;
    return padTo((await fe(gemmaInput(t, inputType), { pooling: "mean", normalize: true })).data);
  } catch (e) {
    console.error("[orbit] embedding error", e);
    return null;
  }
}
