// Local reranker for memory search: Qwen3-Reranker-0.6B in one child process (rerank-worker.mjs). Opt-in: ORBIT_RERANK=1.
// Any failure (child can't start, crash, timeout, bad reply) returns null and search keeps today's hybrid ranking.
import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";

export const rerankEnabled = () => process.env.ORBIT_RERANK === "1";
const budgetMs = () => Math.max(500, Number(process.env.ORBIT_RERANK_MS) || 4_000); // scoring time per search; candidates not scored in time keep their hybrid rank

type Scores = (number | null)[];
type Pending = { resolve: (s: Scores | null) => void; timer: ReturnType<typeof setTimeout> };
const G = globalThis as unknown as { __orbitRerank?: { w: ChildProcess; pending: Map<number, Pending>; seq: number; warm: boolean; warming?: boolean } };

function child() {
  let s = G.__orbitRerank;
  if (s && s.w.connected && !s.w.killed) return s;
  const w = fork(path.join(process.cwd(), "src/lib/rerank-worker.mjs"), [], { execArgv: [], windowsHide: true });
  s = G.__orbitRerank = { w, pending: new Map(), seq: 0, warm: false };
  const st = s;
  const drop = () => { for (const p of st.pending.values()) { clearTimeout(p.timer); p.resolve(null); } st.pending.clear(); if (G.__orbitRerank === st) G.__orbitRerank = undefined; };
  w.on("message", (m: { id?: number; scores?: Scores; error?: string }) => {
    const p = m.id === undefined ? undefined : st.pending.get(m.id);
    if (!p || m.id === undefined) return;
    st.pending.delete(m.id); clearTimeout(p.timer);
    if (m.scores) st.warm = true; else st.warming = false;
    p.resolve(m.scores ?? null);
  });
  w.on("error", drop); w.on("exit", drop);
  return st;
}

/** Per-doc scores (0..1, higher = more relevant; null = not scored in time), or null on any failure. The first call only starts
 *  the model loading (it can download ~600 MB) and returns null at once, so a search never waits on a cold start. */
export async function rerankScores(query: string, docs: string[]): Promise<Scores | null> {
  if (!docs.length) return [];
  try {
    const s = child();
    const id = ++s.seq, cacheDir = path.join(process.cwd(), ".cache", "transformers");
    if (!s.warm) {
      if (!s.warming) { s.warming = true; s.w.send({ id, query: "warm", docs: ["warm"], cacheDir, ms: 1e9 }); s.pending.set(id, { resolve: () => {}, timer: setTimeout(() => { s.warming = false; }, 15 * 60_000) }); }
      return null;
    }
    const ms = budgetMs();
    const r = await new Promise<Scores | null>((resolve) => {
      const timer = setTimeout(() => { s.pending.delete(id); resolve(null); }, ms + 3_000);
      s.pending.set(id, { resolve, timer });
      s.w.send({ id, query, docs, cacheDir, ms });
    });
    return r && r.length === docs.length ? r : null;
  } catch (e) {
    console.error("[orbit] rerank unavailable", e);
    return null;
  }
}
