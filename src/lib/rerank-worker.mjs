// Qwen3-Reranker-0.6B (Apache-2.0, ONNX q8) in a child process (forked by rerank.ts): onnxruntime-node must not load in the
// Next server process next to sherpa's own onnxruntime (see asr-pool.ts), and a native crash here only kills this child.
// In:  {id, query, docs: string[], cacheDir, ms}   Out: {id, scores: (number|null)[]} | {id, error}; {ready: true} once on start.
// Docs are scored in order until `ms` (counted after the model is loaded) runs out; the rest come back null (partial results are fine).
// Plain ESM loaded by path at runtime, so Next never bundles it.
const send = (m) => process.send?.(m);
const MODEL = "onnx-community/Qwen3-Reranker-0.6B-ONNX";
const PREFIX = `<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be "yes" or "no".<|im_end|>\n<|im_start|>user\n<Instruct>: Given a question, retrieve saved notes that answer it\n\n<Query>: `;
let loaded;
const load = (cacheDir) => (loaded ??= import("@huggingface/transformers").then(async (tf) => {
  tf.env.cacheDir = cacheDir;
  const tok = await tf.AutoTokenizer.from_pretrained(MODEL);
  const model = await tf.AutoModelForCausalLM.from_pretrained(MODEL, { dtype: "q8", device: "cpu" });
  const id = (w) => tok.encode(w, { add_special_tokens: false })[0];
  return { tok, model, yes: id("yes"), no: id("no") };
}).catch((e) => { loaded = undefined; throw e; }));

process.on("message", async ({ id, query, docs, cacheDir, ms }) => {
  try {
    const { tok, model, yes, no } = await load(cacheDir);
    const scores = [], end = Date.now() + (ms ?? 1e9);
    for (const d of docs) {
      if (Date.now() > end) { scores.push(null); continue; }
      const out = await model(tok(`${PREFIX}${query}\n\n<Document>: ${d}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n`));
      const [, L, V] = out.logits.dims;
      const l = out.logits.data.slice((L - 1) * V, L * V);
      const m = Math.max(l[yes], l[no]);
      const y = Math.exp(l[yes] - m), n = Math.exp(l[no] - m);
      scores.push(y / (y + n));
    }
    send({ id, scores });
  } catch (e) { send({ id, error: e instanceof Error ? e.message : String(e) }); }
});
send({ ready: true });
