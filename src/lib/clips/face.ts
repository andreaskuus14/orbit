// Face-aware follow reframing, the runner (pure parts: face-pure.ts). YuNet (OpenCV Zoo, MIT, 230 KB) downloads once into
// <studio>/models (hash-checked) and runs in a child process (face-worker.mjs over asr-pool's createPool): onnxruntime-node
// stays out of the server process, and a native crash only kills the child. Any failure here falls back to motion-only
// tracking (reframe.ts): faces are an upgrade, never a reason for a clip to fail.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPool } from "../asr-pool";
import { FACE_PRE, FACE_SMOOTH, FACE_W, YUNET, camMask, decodeYunet, faceFollow, facecamGuess, buildTracks, type CamSide, type Face } from "./face-pure";
import { faceArgs, trackArgs } from "./pure";
import { motionSamples, readRaw, smoothPath, type Key } from "./reframe";

const S = globalThis as unknown as { __orbitYunetDl?: Promise<string> | null; __orbitFacePool?: ReturnType<typeof createPool> };
const BATCH = 24; // frames per worker request (~18 MB at 640x384): keeps each IPC message modest

/** The model file; downloads it once (small: a plain fetch) when it's missing or damaged. */
export function ensureYunet(modelsDir: string): Promise<string> {
  const p = S.__orbitYunetDl ??= (async () => {
    const file = path.join(modelsDir, YUNET.file);
    const ok = await readFile(file).then((b) => createHash("sha256").update(b).digest("hex") === YUNET.sha256, () => false);
    if (ok) return file;
    await mkdir(modelsDir, { recursive: true });
    const res = await fetch(YUNET.url, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`YuNet download failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (createHash("sha256").update(buf).digest("hex") !== YUNET.sha256) throw new Error("YuNet download was damaged (hash mismatch)");
    await writeFile(`${file}.part`, buf);
    await rename(`${file}.part`, file);
    return file;
  })();
  p.catch(() => { if (S.__orbitYunetDl === p) S.__orbitYunetDl = null; rm(path.join(modelsDir, `${YUNET.file}.part`), { force: true }).catch(() => {}); });
  return p;
}

const pool = () => (S.__orbitFacePool ??= createPool(path.join(process.cwd(), "src/lib/clips/face-worker.mjs"), 1, 30_000, "YuNet"));

/** Faces on every sampled frame of a clip span (TRACK_FPS, aligned with trackArgs' frames), plus the source aspect. */
export async function detectFaces(ff: string, model: string, src: string, start: number, duration: number, signal: AbortSignal): Promise<{ frames: Face[][]; aspect: number }> {
  const r = await readRaw(ff, faceArgs(src, start, duration, FACE_W), signal);
  if (!r.outW || !r.outH) throw new Error("face frames: no output size");
  const w = r.outW, h = r.outH, h0 = Math.min(h, 2 * Math.round(FACE_W * r.inH / r.inW / 2)), size = w * h * 3, n = Math.floor(r.buf.length / size);
  const p = pool(), frames: Face[][] = [];
  await p.run({ model }, 60_000);
  for (let i = 0; i < n; i += BATCH) {
    if (signal.aborted) throw signal.reason ?? new Error("aborted");
    const part = new Uint8Array(r.buf.buffer, r.buf.byteOffset + i * size, Math.min(BATCH, n - i) * size);
    const cells = (await p.run({ model, frames: part, w, h, pre: FACE_PRE }, 120_000)) as Float32Array[];
    for (const c of cells) frames.push(decodeYunet(c, w, h, FACE_W, h0));
  }
  return { frames, aspect: r.inW / r.inH };
}

export type FollowResult = { keys: Key[]; faceShots: number; shots: number; cam: { side: CamSide; size: number } | null; faceError?: string };

/** Follow-crop keys for a clip span: faces first (subject face per shot, facecam ignored and masked), motion where a shot has
 *  no subject face, and motion only when the face model can't run (faceError says why). */
export async function trackFollow(ff: string, src: string, start: number, duration: number, modelsDir: string, signal: AbortSignal): Promise<FollowResult> {
  const grey = readRaw(ff, trackArgs(src, start, duration), signal);
  const faces = ensureYunet(modelsDir).then((m) => detectFaces(ff, m, src, start, duration, signal));
  const [g, f] = await Promise.allSettled([grey, faces]);
  if (g.status === "rejected") throw g.reason;
  const aspect = g.value.inW / g.value.inH;
  const plain = motionSamples(g.value.buf, aspect);
  if (!plain) return { keys: [], faceShots: 0, shots: 0, cam: null };
  if (f.status === "rejected") {
    if (signal.aborted) throw f.reason;
    return { keys: smoothPath(plain), faceShots: 0, shots: 0, cam: null, faceError: f.reason instanceof Error ? f.reason.message : String(f.reason) };
  }
  const first = faceFollow(plain, f.value.frames, aspect);
  const mask = camMask(first.cams);
  const ff2 = mask ? faceFollow(motionSamples(g.value.buf, aspect, mask)!, f.value.frames, aspect) : first; // motion without the cam's movement
  const guess = facecamGuess(buildTracks(plain.map((_, i) => f.value.frames[i] ?? []), plain.map((s) => !!s.cut)));
  return {
    keys: ff2.faceShots ? smoothPath(ff2.samples, FACE_SMOOTH) : smoothPath(ff2.samples),
    faceShots: ff2.faceShots, shots: ff2.shots, cam: guess && { side: guess.side, size: guess.size },
  };
}

/** Facecam corner for split layouts: null when there's no facecam or the model can't run. */
export async function findFacecam(ff: string, src: string, start: number, duration: number, modelsDir: string, signal: AbortSignal): Promise<{ side: CamSide; size: number } | null> {
  try {
    const { frames } = await detectFaces(ff, await ensureYunet(modelsDir), src, start, duration, signal);
    const g = facecamGuess(buildTracks(frames, frames.map(() => false))); // a facecam stays put across gameplay cuts
    return g && { side: g.side, size: g.size };
  } catch (e) { if (signal.aborted) throw e; return null; }
}
