// Embeddings for memory search, 1024 dims to match the DB column. Two providers (embeddings-pure.ts picks):
// - local (default without a Voyage key): EmbeddingGemma-300M on this PC via transformers.js, q8, ~200 ms each. Free, offline.
// - voyage: the hosted API, kept for existing installs so stored vectors stay comparable until re-embedded (POST /api/memories/reembed).
import { createHash } from "node:crypto";
import { chunkText, gemmaInput, journalsComparable, meanVector, padTo, provider } from "./embeddings-pure";
import { createTtlCache, envOn } from "./ttl-cache-pure";
import type { PrivRow } from "./private-pure";

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

// Query vectors are deterministic per (provider, text): CORE embeds the same question twice per turn (memories + chat
// summaries, core.ts prep), so one in-flight/10-minute cache serves both. Keyed by a hash, never the text. ORBIT_EMBED_CACHE=0 = off.
const Q = globalThis as unknown as { __orbitQueryVecs?: ReturnType<typeof createTtlCache<number[] | null>> };
const queryVecs = (Q.__orbitQueryVecs ??= createTtlCache<number[] | null>({ max: 200, ttlMs: 10 * 60_000 }));

/** `kind` is the memory's kind (or the row: kind + tags) when embedding a stored memory; a private one (private-pure.ts)
 *  never goes to the hosted provider. */
export async function embed(text: string, inputType: "document" | "query", kind?: string | PrivRow): Promise<number[] | null> {
  if (inputType !== "query" || !envOn(process.env.ORBIT_EMBED_CACHE)) return embedNow(text, inputType, kind);
  const key = createHash("sha256").update(`${embeddingProvider()}\0${typeof kind === "string" ? kind : kind ? JSON.stringify([kind.kind, kind.tags]) : ""}\0${text}`).digest("hex");
  return queryVecs.memo(key, () => embedNow(text, inputType, kind)).then((v) => (v ? [...v] : v)); // a copy: callers may not share one array
}

async function embedNow(text: string, inputType: "document" | "query", kind?: string | PrivRow): Promise<number[] | null> {
  // Hosted Voyage has a long window: it still gets the first 8k chars. The local model (2k-token window) embeds a long
  // document in chunks and stores their normalized mean as the one vector (no schema change; the tail is no longer ignored).
  const t = text.slice(0, 8_000);
  try {
    if (provider({ ORBIT_EMBED: process.env.ORBIT_EMBED, VOYAGE_API_KEY: process.env.VOYAGE_API_KEY }, kind) === "voyage") return await voyage(t, inputType);
    const fe = await local();
    if (!fe) return null;
    const one = async (c: string) => (await fe(gemmaInput(c, inputType), { pooling: "mean", normalize: true })).data;
    const chunks = inputType === "document" ? chunkText(text) : [t];
    if (chunks.length === 1) return padTo(await one(chunks[0]));
    const vecs: ArrayLike<number>[] = [];
    for (const c of chunks) vecs.push(await one(c)); // sequential: one onnx session
    const m = meanVector(vecs);
    return m && padTo(m);
  } catch (e) {
    console.error("[orbit] embedding error", e);
    return null;
  }
}
