// Embedding provider choice and shaping (pure, tested in tests/embeddings.test.ts).
import { isPrivate, isPrivateKind, type PrivRow } from "./private-pure.ts";

export const DIM = 1024; // the DB column; EmbeddingGemma gives 768, zero-padding keeps cosine similarity unchanged
export type Provider = "local" | "voyage";

export const LOCAL_EMBED_MODEL = "onnx-community/embeddinggemma-300m-ONNX";
export const LOCAL_EMBED_DTYPE = "q8" as const;

export type ModelFileSpec = { relPath: string; size: number; sha256: string };

/** Expected size + SHA-256 for the local EmbeddingGemma-300M (q8) ONNX artifacts.
 *  Used by embeddings.ts to detect truncated or corrupted downloads before/after load and re-fetch cleanly. */
export const LOCAL_EMBED_FILES: readonly ModelFileSpec[] = [
  { relPath: "onnx/model_quantized.onnx", size: 567_874, sha256: "172efde319fe1542dc41f31be6154910b05b78f7a861c265c4600eec906bd6d8" },
  { relPath: "onnx/model_quantized.onnx_data", size: 308_890_624, sha256: "705626e28e4c23c82ade34566b4197d97f534c12275fa406dfb71e9937d388c0" },
];

export type ModelFileStat = { size: number; sha256?: string } | null;
export type ModelCheckResult =
  | { status: "ok" }
  | { status: "missing" }
  | { status: "corrupt"; file: string; reason: "partial" | "size" | "hash" };

/** Pure integrity check over cached model files:
 *  - all missing -> "missing" (fresh install, let transformers.js download)
 *  - some present & some missing -> "corrupt" ("partial")
 *  - any present file has wrong byte size -> "corrupt" ("size")
 *  - any present file has wrong sha256 (when provided) -> "corrupt" ("hash") */
export function checkModelFiles(
  actual: Record<string, ModelFileStat>,
  specs: readonly ModelFileSpec[] = LOCAL_EMBED_FILES,
): ModelCheckResult {
  let present = 0;
  for (const spec of specs) {
    if (actual[spec.relPath]) present++;
  }
  if (present === 0) return { status: "missing" };
  for (const spec of specs) {
    const info = actual[spec.relPath];
    if (!info) return { status: "corrupt", file: spec.relPath, reason: "partial" };
    if (info.size !== spec.size) return { status: "corrupt", file: spec.relPath, reason: "size" };
    if (info.sha256 && info.sha256.toLowerCase() !== spec.sha256.toLowerCase()) {
      return { status: "corrupt", file: spec.relPath, reason: "hash" };
    }
  }
  return { status: "ok" };
}

const CORRUPT_ERR_RE = /out of bounds|can not be read in full|Deserialize tensor|External initializer|Protobuf|Unexpected end of JSON/i;

/** True when an ONNX/transformers.js load failure looks like a truncated or corrupted cached file. */
export function isCorruptModelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return CORRUPT_ERR_RE.test(msg);
}

/** ORBIT_EMBED wins; otherwise Voyage when a key is set (its stored vectors stay comparable), else the free local model.
 *  A journal entry is always embedded locally: journal text never leaves ORBIT (AGENTS.md rule 6). */
export function provider(env: { ORBIT_EMBED?: string; VOYAGE_API_KEY?: string }, kind?: string | PrivRow): Provider {
  if (typeof kind === "string" ? isPrivateKind(kind) : kind && isPrivate(kind)) return "local"; // private-pure.ts: kind or tags
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
