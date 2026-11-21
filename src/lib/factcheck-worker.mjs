// Fact check NLI model in a child process (forked through asr-pool.ts createPool by factcheck.ts): onnxruntime-node must not
// load in the Next server next to sherpa's own onnxruntime, and a native crash here only kills this child.
// Model: MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli (MIT), ONNX q8 from Xenova (~240 MB), CPU.
// In:  {id, model, cacheDir, pairs?: [premise, hypothesis][], ms?}  (no pairs = just load the model)
// Out: {id, result: ([entail, neutral, contradict] | null)[]} | {id, error} | {id, error, load: true}; {ready: true} once on start.
// Pairs are scored in order until `ms` (counted after the model is loaded) runs out; the rest come back null.
// Plain ESM loaded by path at runtime, so Next never bundles it.
const send = (m) => process.send?.(m);
const loaded = new Map(); // model id -> Promise<{tok, model, order}>

function load(model, cacheDir) {
  let p = loaded.get(model);
  if (!p) {
    p = import("@huggingface/transformers").catch((e) => { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { load: true }); }).then(async (tf) => {
      tf.env.cacheDir = cacheDir;
      const tok = await tf.AutoTokenizer.from_pretrained(model);
      const m = await tf.AutoModelForSequenceClassification.from_pretrained(model, { dtype: "q8", device: "cpu" });
      // Map the model's own labels to [entail, neutral, contradict] (label order differs between NLI models).
      const names = Object.entries(m.config.id2label ?? {}).map(([i, n]) => [Number(i), String(n).toLowerCase()]);
      const at = (re) => names.find(([, n]) => re.test(n))?.[0];
      const order = [at(/entail/), at(/neutral/), at(/contra/)];
      if (order.some((i) => i === undefined)) throw new Error(`not a 3-way NLI model: ${JSON.stringify(m.config.id2label)}`);
      return { tok, model: m, order };
    });
    loaded.set(model, p);
    p.catch(() => loaded.delete(model)); // the next request retries a failed download
  }
  return p;
}

process.on("message", async ({ id, model, cacheDir, pairs, ms }) => {
  try {
    const { tok, model: m, order } = await load(model, cacheDir);
    const result = [], end = Date.now() + (ms ?? 1e9);
    for (const [premise, hypothesis] of pairs ?? []) {
      if (Date.now() > end) { result.push(null); continue; }
      const x = tok(premise, { text_pair: hypothesis, truncation: true, max_length: 512 });
      const l = Array.from((await m(x)).logits.data);
      const mx = Math.max(...l), e = l.map((v) => Math.exp(v - mx)), s = e.reduce((a, b) => a + b, 0);
      result.push(order.map((i) => Math.round((e[i] / s) * 1000) / 1000));
    }
    send({ id, result });
  } catch (e) { send({ id, error: e instanceof Error ? e.message : String(e), ...(e?.load && { load: true }) }); }
});
send({ ready: true });
