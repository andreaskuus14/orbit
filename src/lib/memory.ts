import { createHash } from "node:crypto";
import { withEvalTag } from "./eval-run";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { pipeline } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { embed, journalVectorsComparable } from "./embeddings";
import { emit } from "./claude";
import { verifyRow } from "./completion";
import { htmlToText, pickPublicAddress, assertHttpUrl, redirectTarget, readCapped } from "./pure";
import { MEMORY_COLUMNS, retrieveMemories, type MemorySearchOptions } from "./memory-search";
import { dupPlan, findDuplicate, provenance, provenanceTags, type DupChoice, type DupRow } from "./memory-capture-pure";
import { correctionRecords, isMissingColumn } from "./provenance-pure";
export { MEMORY_COLUMNS } from "./memory-search";

import { KINDS, type Kind } from "./kinds";
export { KINDS, type Kind };

export type MemoryInput = {
  kind: Kind;
  title: string;
  content: string;
  source: string;
  url?: string | null;
  storage_path?: string | null;
  tags?: string[];
  folder?: string | null;
};

const SUGGEST_THRESHOLD = 0.6;

/** Store a memory, embed it, emit a universe event, and suggest (never auto-confirm) related memories. */
export async function createMemory(sb: SupabaseClient, userId: string, input: MemoryInput) {
  // MEM04: every capture path (notes, links, voice memos, files, CORE) carries the same provenance tags.
  if (!input.tags?.some((t) => t.startsWith("fp:"))) input = { ...input, tags: [...(input.tags ?? []), ...provenanceTags(provenance(input))] };
  const embedding = await embed(`${input.title}\n\n${input.content}`, "document", input.kind);
  const { data, error } = await sb
    .from("memories")
    .insert({ ...input, user_id: userId, embedding: embedding ? JSON.stringify(embedding) : null })
    .select(MEMORY_COLUMNS)
    .single();
  if (error) throw error;

  await verifyRow(sb, userId, "memories", data.id, { title: input.title, content: input.content });

  let suggested = 0;
  const mixed = !journalVectorsComparable(); // journal vectors are local, the rest hosted: never compared with each other
  if (embedding && !(mixed && input.kind === "journal")) {
    const { data: similar, error: simErr } = await sb.rpc("match_memories", {
      query_embedding: JSON.stringify(embedding), match_count: 3, exclude_id: data.id,
    });
    if (simErr) console.error("[orbit] link suggestion failed", simErr);
    const links = ((similar ?? []) as { id: string; kind?: string; similarity: number }[])
      .filter((s) => s.similarity >= SUGGEST_THRESHOLD && !(mixed && s.kind === "journal"))
      .map((s) => ({ user_id: userId, from_id: data.id, to_id: s.id, score: s.similarity, reason: "semantic similarity" }));
    if (links.length) {
      const { error: linkErr } = await sb.from("memory_links").insert(links);
      if (linkErr) console.error("[orbit] failed to store suggestions", linkErr);
      else suggested = links.length;
    }
  }

  await emit(sb, userId, "memory.created", "memory", { id: data.id, title: data.title, kind: data.kind, source: data.source, suggested });
  await emit(sb, userId, "memory.saved", "memory", { memoryId: data.id, kind: data.kind });
  return { memory: data, embedded: !!embedding, suggested };
}

/** MEM04 capture without silent copies. A repeat (same stable source, or the same normalized text, within the same kind)
 *  returns {duplicate, preview} and writes nothing until the owner picks keep (a marked separate version), merge or update
 *  (the old text is kept as a "superseded" history copy, like Correct). No model call besides the usual embedding. */
export async function captureMemory(sb: SupabaseClient, userId: string, input: MemoryInput, opts: { vault?: string | null; fileHash?: string | null; onDuplicate?: DupChoice | null; attach?: () => Promise<string> } = {}) {
  const make = async (extra: string[]) => ({ ...(await createMemory(sb, userId, { ...input, tags: withEvalTag([...tags, ...extra]), ...(opts.attach ? { storage_path: await opts.attach() } : {}) })), duplicate: dup });
  let dup: ReturnType<typeof findDuplicate> = null;
  const p = provenance({ ...input, ...opts });
  const tags = [...(input.tags ?? []), ...provenanceTags(p)];
  const cols = "id, title, content, tags, url, created_at, kind";
  const keys = tags.filter((t) => /^(fp|sid):/.test(t));
  const [byTag, legacy] = await Promise.all([
    sb.from("memories").select(cols).eq("user_id", userId).eq("kind", input.kind).overlaps("tags", keys).limit(10),
    // rows saved before provenance tags: same link, or same title (the text compare happens in findDuplicate)
    sb.from("memories").select(cols).eq("user_id", userId).eq("kind", input.kind).eq(input.url ? "url" : "title", input.url || input.title).limit(10),
  ]);
  if (byTag.error) throw byTag.error;
  const rows = [...(byTag.data ?? []), ...(legacy.data ?? [])].map((r) => ({ ...r, content: String(r.content ?? ""), tags: (r.tags ?? []) as string[] })) as DupRow[];
  dup = findDuplicate(p, rows);
  if (!dup) return make([]);
  const cur = rows.find((r) => r.id === dup.id)!;
  const plan = dupPlan(cur, input.content, opts.onDuplicate ?? undefined);
  if ("preview" in plan) return { duplicate: dup, preview: plan.preview };
  if (plan.create) return make(plan.tags);
  if (plan.content !== null) {
    if ("history" in plan) {
      const ins: Record<string, unknown> = { ...correctionRecords({ ...cur, kind: input.kind }, plan.content).insert, user_id: userId };
      let r = await sb.from("memories").insert(ins);
      if (isMissingColumn(r.error)) { delete ins.source_ref; delete ins.confirmation; r = await sb.from("memories").insert(ins); } // until 0019
      if (r.error) throw r.error;
    }
    const e = await embed(`${cur.title}\n\n${plan.content}`, "document", input.kind); // duplicates are looked up within input.kind
    const { error } = await sb.from("memories").update({ content: plan.content, tags: [...new Set([...cur.tags, ...keys])], embedding: e ? JSON.stringify(e) : null }).eq("id", cur.id);
    if (error) throw error;
    await emit(sb, userId, "memory.updated", "memory", { id: cur.id });
  }
  return { memory: { id: cur.id, title: cur.title }, embedded: true, suggested: 0, duplicate: dup, changed: plan.content !== null };
}

export const fileHash = (buf: Uint8Array) => createHash("sha256").update(buf).digest("hex").slice(0, 32);

/** The caller's memories whose embedding is at least `min` cosine-similar to `text` ([] when embeddings are off). Needs a user-session client (match_memories filters by auth.uid()). */
export async function findSimilar(sb: SupabaseClient, text: string, min = 0.9, count = 3) {
  const e = await embed(text, "document");
  if (!e) return [];
  const { data, error } = await sb.rpc("match_memories", { query_embedding: JSON.stringify(e), match_count: count });
  if (error) throw error;
  const mixed = !journalVectorsComparable();
  return ((data ?? []) as { id: string; title: string; kind: string; similarity: number }[]).filter((m) => m.similarity >= min && !(mixed && m.kind === "journal"));
}

/** Hybrid search: Postgres full-text + pgvector similarity, fused by reciprocal rank. */
/** userId is required when sb bypasses row-level security (background automations); harmless otherwise. */
export async function searchMemories(sb: SupabaseClient, query: string, limit = 10, userId?: string, options: MemorySearchOptions = {}) {
  return retrieveMemories(sb, query, limit, userId, embed, { ...options, journalVectors: journalVectorsComparable() });
}

type Pinned = { address: string; family: number };

/** One GET connected to an already-validated IP (custom lookup), so DNS can't be re-answered between check and
 *  connect (rebinding). TLS still verifies the certificate for the real hostname. Reads at most maxBytes. */
function pinnedGet(url: URL, ip: Pinned, headers: Record<string, string>, maxBytes: number, signal: AbortSignal) {
  return new Promise<{ status: number; headers: Headers; body: Uint8Array<ArrayBuffer> }>((resolve, reject) => {
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET", headers, signal,
      lookup: ((_host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
        opts?.all ? cb(null, [ip]) : cb(null, ip.address, ip.family)) as never,
    }, (res) => {
      const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
      const decoder = enc === "gzip" || enc === "x-gzip" ? createGunzip() : enc === "br" ? createBrotliDecompress() : enc === "deflate" ? createInflate() : null;
      const stream = decoder ? pipeline(res, decoder, () => {}) : res; // the cap counts decoded bytes (zip-bomb safe)
      const hdrs = new Headers();
      try {
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) hdrs.set(k, Array.isArray(v) ? v.join(", ") : v);
      } catch (e) { req.destroy(); return reject(e); } // a header value Headers rejects would otherwise throw uncaught
      const status = res.statusCode ?? 0;
      // Redirects and errors: the body is never used, so don't download it.
      if (status < 200 || status >= 300) { req.destroy(); return resolve({ status, headers: hdrs, body: new Uint8Array() }); }
      readCapped(stream, maxBytes).then((r) => { req.destroy(); resolve({ status, headers: hdrs, body: r.bytes }); }, reject);
    });
    req.on("error", reject);
    req.end();
  });
}

/** GET a public http(s) URL, following up to 5 redirects manually and refusing private/internal addresses
 *  (SSRF guard). Every hop is re-resolved, checked and connected to the checked IP. The body is capped at
 *  maxBytes while downloading and returned as an in-memory Response. */
export async function safeFetch(rawUrl: string, accept: string, userAgent = "ORBIT/0.2 (personal knowledge assistant)", maxBytes = 3_000_000): Promise<{ res: Response; url: URL }> {
  let url = assertHttpUrl(new URL(rawUrl));
  const headers = { "User-Agent": userAgent, Accept: accept, "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip, deflate, br" };
  for (let hop = 0; hop <= 5; hop++) {
    const ip = pickPublicAddress(await lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true }));
    const r = await pinnedGet(url, ip, headers, maxBytes, AbortSignal.timeout(10_000));
    const next = redirectTarget(r.status, r.headers.get("location"), url);
    if (next) { url = next; continue; }
    if (r.status < 200 || r.status >= 300) throw new Error(`The site answered ${r.status}`);
    const res = new Response(r.status === 204 || r.status === 205 ? null : r.body, { status: r.status, headers: r.headers });
    return { res, url };
  }
  throw new Error("Too many redirects");
}

/** Fetch a public web page for link capture. */
export async function fetchPage(rawUrl: string): Promise<{ title: string; text: string; url: string }> {
  const { res, url } = await safeFetch(rawUrl, "text/html,text/plain", undefined, 2_000_000);
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("text/html") && !type.includes("text/plain")) throw new Error(`Unsupported content type: ${type || "unknown"}`);
  const body = await res.text(); // already capped at 2 MB by safeFetch
  const page = type.includes("text/html") ? htmlToText(body) : { title: "", text: body };
  return { title: page.title || url.hostname, text: page.text.slice(0, 50_000), url: url.toString() };
}
