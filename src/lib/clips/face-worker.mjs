// YuNet face detection (onnxruntime-node) in a child process, forked by face.ts through asr-pool's createPool, like the ASR
// workers: a native crash only kills this child, and onnxruntime never shares the server process with sherpa-onnx.
// Plain ESM loaded by path, never bundled. The parent downloads and hash-checks the model; this file only loads and runs it.
// In:  {id, model, frames?: Uint8Array (n frames of w*h*3 BGR, packed), w, h, pre}  (no frames = just load the model)
// Out: {id, result: Float32Array[] | null} (per frame, flat cells: stride, cell index, score, 4 box values; decoded in
//      face-pure.ts decodeYunet) | {id, error, load?} | {id, phase: "loading"}; {ready: true} once on start.
const send = (m) => process.send?.(m);
const sessions = new Map(); // model path → Promise<{ ort, s }>

function load(id, model) {
  let p = sessions.get(model);
  if (!p) {
    send({ id, phase: "loading" });
    p = import("onnxruntime-node").catch((e) => { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { load: true }); })
      .then(async (m) => { const ort = m.default ?? m; return { ort, s: await ort.InferenceSession.create(model, { intraOpNumThreads: 2 }) }; });
    sessions.set(model, p);
    p.catch(() => sessions.delete(model));
  }
  return p;
}

const STRIDES = [8, 16, 32];

process.on("message", async ({ id, model, frames, w, h, pre = 0.5 }) => {
  const msg = (e) => (e instanceof Error ? e.message : String(e));
  let m;
  try { m = await load(id, model); } catch (e) { return send({ id, error: msg(e), ...(e?.load ? { load: true } : {}) }); }
  if (!frames) return send({ id, result: null });
  try {
    const { ort, s } = m, plane = w * h, n = Math.floor(frames.length / (plane * 3)), out = [];
    const input = new Float32Array(3 * plane);
    for (let i = 0; i < n; i++) {
      const f = frames.subarray(i * plane * 3, (i + 1) * plane * 3);
      for (let k = 0; k < plane; k++) { input[k] = f[k * 3]; input[plane + k] = f[k * 3 + 1]; input[2 * plane + k] = f[k * 3 + 2]; } // BGR HWC → NCHW, 0..255
      const r = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, h, w]) });
      const cells = [];
      for (const st of STRIDES) {
        const cls = r[`cls_${st}`].data, obj = r[`obj_${st}`].data, box = r[`bbox_${st}`].data;
        for (let c = 0; c < cls.length; c++) {
          const score = Math.sqrt(Math.min(1, Math.max(0, cls[c])) * Math.min(1, Math.max(0, obj[c])));
          if (score >= pre) cells.push(st, c, score, box[c * 4], box[c * 4 + 1], box[c * 4 + 2], box[c * 4 + 3]);
        }
      }
      out.push(Float32Array.from(cells));
    }
    send({ id, result: out });
  } catch (e) {
    send({ id, error: msg(e) });
  }
});
process.on("disconnect", () => process.exit(0));
send({ ready: true });
