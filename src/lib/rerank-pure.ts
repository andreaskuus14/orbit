// Memory-search reranking, pure parts (tested in tests/rerank.test.ts). The model runs in rerank.ts / rerank-worker.mjs.
export const RERANK_POOL = 30;   // candidates sent to the reranker
export const RERANK_DOC_CHARS = 600; // per candidate, title first: CPU cost grows with length (~15 ms/token on 2 cores)

import { isPrivate } from "./private-pure.ts";

export type RerankItem = { id: string; kind?: string; title?: string; content?: string; tags?: string[] | null };

/** What the reranker may see. Journal/LIFE entries never go in (AGENTS.md): they are not scored and keep their place. */
export const rerankable = (m: RerankItem) => !isPrivate(m); // the local reranker is a model too
export const rerankDoc = (m: RerankItem) => `${m.title ?? ""}\n${m.content ?? ""}`.trim().slice(0, RERANK_DOC_CHARS);

/** Reorder `ids` by score (higher first, stable). Only ids with a score move, and only among the slots scored ids already
 *  occupy: unscored ids (journal, missing rows) stay exactly where they were, and nothing is added or dropped. */
export function applyRerank(ids: string[], scores: ReadonlyMap<string, number>): string[] {
  const slots: number[] = [];
  ids.forEach((id, i) => { if (Number.isFinite(scores.get(id))) slots.push(i); });
  const order = slots.map((i) => ids[i]).map((id, k) => ({ id, k })).sort((a, b) => scores.get(b.id)! - scores.get(a.id)! || a.k - b.k);
  const out = [...ids];
  slots.forEach((slot, j) => { out[slot] = order[j].id; });
  return out;
}

/** Reranker prompt (Qwen3-Reranker's documented format). */
export const rerankPrompt = (query: string, doc: string) =>
  `<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be "yes" or "no".<|im_end|>\n<|im_start|>user\n<Instruct>: Given a question, retrieve saved notes that answer it\n\n<Query>: ${query}\n\n<Document>: ${doc}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n`;

/** P(yes) from the last-token logits of "yes" and "no". */
export const yesProbability = (yes: number, no: number) => { const m = Math.max(yes, no); const y = Math.exp(yes - m), n = Math.exp(no - m); return y / (y + n); };
