// Manual check of the real Qwen3-Reranker on text fixtures (not part of the gate: needs the ~600 MB model and a CPU pass).
// Run: node --experimental-strip-types scripts/rerank-eval.ts   Each case lists candidates in the (wrong) order hybrid search gave them.
import { fork } from "node:child_process";
import path from "node:path";

const CASES: { q: string; docs: string[]; right: number }[] = [
  { q: "what did we decide about DataStore throttling", right: 2, docs: ["Pet sim: DataStore keys are named player_<id>.", "Roblox DataStore docs reading list.", "Decision: batch DataStore writes through a queue because of throttling."] },
  { q: "which lead asked for a quote last week", right: 1, docs: ["Lead list: all prospects with quote templates.", "Marko from Tallinn Dental asked for a quote on Tuesday."] },
  { q: "where do I keep the thumbnail style rules", right: 2, docs: ["Thumbnail ideas for the next video.", "Style guide for Roblox avatars.", "Thumbnail rules: big face, three words, yellow outline. Saved in STUDIO notes."] },
  { q: "backup schedule for the vault", right: 0, docs: ["Vault files are backed up every night at 02:00 to the second drive.", "Vault folder names follow the project list.", "Schedule for posting Shorts."] },
  { q: "why did we drop Z-Image-Turbo", right: 1, docs: ["Z-Image-Turbo is a fast text-to-image model.", "Dropped Z-Image-Turbo: Andreas picked NitroFusion2 after the test.", "Image models need 8 GB VRAM."] },
  { q: "gym plan", right: 2, docs: ["Plan for the pet sim launch.", "Study plan for architecture entrance.", "Gym plan: Mon legs, Wed push, Fri pull."] },
];
const w = fork(path.join(process.cwd(), "src/lib/rerank-worker.mjs"), [], { execArgv: [] });
let id = 0;
const ask = (query: string, docs: string[]) => new Promise<number[]>((res, rej) => {
  const n = ++id;
  const on = (m: { id?: number; scores?: number[]; error?: string }) => { if (m.id !== n) return; w.off("message", on); m.scores ? res(m.scores) : rej(new Error(m.error)); };
  w.on("message", on); w.send({ id: n, query, docs, cacheDir: path.join(process.cwd(), ".cache", "transformers") });
});
let before = 0, after = 0;
for (const c of CASES) {
  const s = await ask(c.q, c.docs);
  const top = s.indexOf(Math.max(...s));
  // "before": hybrid order puts the right doc first only when it is index 0
  if (c.right === 0) before++;
  if (top === c.right) after++;
  console.log(`${top === c.right ? "ok " : "MISS"} ${c.q} -> ${s.map((x) => x.toFixed(2)).join(" ")}`);
}
console.log(`top-1: ${before}/${CASES.length} hybrid order -> ${after}/${CASES.length} reranked`);
w.kill();
