// Embeddings for memory search, 1024 dims to match the DB column. Two providers (embeddings-pure.ts picks):
// - local (default without a Voyage key): EmbeddingGemma-300M on this PC via transformers.js, q8, ~200 ms each. Free, offline.
// - voyage: the hosted API, kept for existing installs so stored vectors stay comparable until re-embedded (POST /api/memories/reembed).
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  checkModelFiles,
  chunkText,
  makeStamp,
  stampCovers,
  VERIFIED_STAMP,
  type FileTimes,
  gemmaInput,
  isCorruptModelError,
  journalsComparable,
  LOCAL_EMBED_DTYPE,
  LOCAL_EMBED_FILES,
  LOCAL_EMBED_MODEL,
  meanVector,
  padTo,
  provider,
  type ModelCheckResult,
  type ModelFileStat,
} from "./embeddings-pure";
import { createTtlCache, envOn } from "./ttl-cache-pure";
import type { PrivRow } from "./private-pure";

export const embeddingsEnabled = () => true; // the local model is always available; a load failure just returns null below
export const embeddingProvider = () => provider({ ORBIT_EMBED: process.env.ORBIT_EMBED, VOYAGE_API_KEY: process.env.VOYAGE_API_KEY });
export const journalVectorsComparable = () => journalsComparable({ ORBIT_EMBED: process.env.ORBIT_EMBED, VOYAGE_API_KEY: process.env.VOYAGE_API_KEY });

/** Persistent cache outside node_modules (matches rerank.ts) so npm ci never wipes the ~309 MB weights. */
export const embedCacheDir = () => path.join(process.cwd(), ".cache", "transformers");

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** Inspect cached ONNX files by size first, then streaming SHA-256 when size matches. Files already hashed OK and unchanged since
 *  (VERIFIED_STAMP in the model folder) are not hashed again. */
export async function inspectModelCache(
  modelDir: string,
  specs: readonly { relPath: string; size: number; sha256: string }[] = LOCAL_EMBED_FILES,
): Promise<ModelCheckResult> {
  const times: Record<string, FileTimes> = {};
  for (const spec of specs) {
    const st = await stat(path.join(modelDir, ...spec.relPath.split("/"))).catch(() => null);
    times[spec.relPath] = st ? { size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs } : null;
  }
  const stampFile = path.join(modelDir, VERIFIED_STAMP);
  if (stampCovers(await readFile(stampFile, "utf8").then(JSON.parse, () => null), times, specs)) return { status: "ok" };
  const r = await hashModelCache(modelDir, specs);
  if (r.status === "ok") await writeFile(stampFile, JSON.stringify(makeStamp(times, specs))).catch(() => {}); // best effort: no stamp = hash next time
  else await rm(stampFile, { force: true }).catch(() => {});
  return r;
}

async function hashModelCache(modelDir: string, specs: readonly { relPath: string; size: number; sha256: string }[]): Promise<ModelCheckResult> {
  const actual: Record<string, ModelFileStat> = {};
  for (const spec of specs) {
    const full = path.join(modelDir, ...spec.relPath.split("/"));
    try {
      const st = await stat(full);
      const sha256 = st.size === spec.size ? await sha256File(full) : undefined;
      actual[spec.relPath] = { size: st.size, sha256 };
    } catch {
      actual[spec.relPath] = null;
    }
  }
  return checkModelFiles(actual, specs);
}

type FE = (s: string, o: { pooling: "mean"; normalize: boolean }) => Promise<{ data: ArrayLike<number> }>;
const G = globalThis as unknown as { __orbitEmbed?: Promise<FE | null> };

async function loadLocalPipeline(): Promise<FE | null> {
  const cacheDir = embedCacheDir();
  const modelDir = path.join(cacheDir, ...LOCAL_EMBED_MODEL.split("/"));

  const pre = await inspectModelCache(modelDir);
  if (pre.status === "corrupt") {
    console.warn(`[orbit] local embedding cache corrupt (${pre.reason}: ${pre.file}); purging and re-fetching`);
    await rm(modelDir, { recursive: true, force: true }).catch(() => {});
  }

  const tf = await import("@huggingface/transformers");
  const open = () =>
    tf.pipeline("feature-extraction", LOCAL_EMBED_MODEL, {
      dtype: LOCAL_EMBED_DTYPE,
      cache_dir: cacheDir,
    }) as unknown as Promise<FE>;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fe = await open();
      const post = await inspectModelCache(modelDir);
      if (post.status === "corrupt") {
        console.warn(`[orbit] local embedding download incomplete (${post.reason}: ${post.file}); purging`);
        await rm(modelDir, { recursive: true, force: true }).catch(() => {});
        if (attempt === 0) continue;
        return null;
      }
      return fe;
    } catch (e) {
      if (attempt === 0 && isCorruptModelError(e)) {
        console.warn("[orbit] local embedding model failed with corrupt-file error; purging cache and retrying once", e);
        await rm(modelDir, { recursive: true, force: true }).catch(() => {});
        continue;
      }
      throw e;
    }
  }
  return null;
}

const W = globalThis as unknown as { __orbitEmbedReady?: boolean };
const local = () =>
  (G.__orbitEmbed ??= loadLocalPipeline().then((fe) => { W.__orbitEmbedReady = !!fe; return fe; }, (e) => {
    console.error("[orbit] local embedding model failed to load", e);
    G.__orbitEmbed = undefined;
    return null;
  }));

/** True when a query vector can come back in ~200 ms: Voyage, or the local model already loaded. */
export const embedWarm = () => embeddingProvider() === "voyage" || !!W.__orbitEmbedReady;
/** Load the local model in the background (server start), so the first CORE search doesn't wait for it. Never throws. */
export function warmEmbeddings(): void {
  if (embeddingProvider() !== "local" || process.env.ORBIT_EMBED_WARM === "0") return;
  const t0 = Date.now();
  void local().then((fe) => { if (fe) console.log(`[orbit] local embedding model ready (${Date.now() - t0} ms)`); });
}

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
