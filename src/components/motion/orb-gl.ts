// CORE thinking orb: a tiny raw-WebGL2 renderer (one full-screen triangle, one fragment shader; no three.js needed).
// Measures its own GPU time with EXT_disjoint_timer_query_webgl2 when the browser offers it (for the automatic step-down).
// Returns null when WebGL2 or the shader isn't available, so the caller keeps the CSS orb.
import type { OrbUniforms } from "@/lib/orb-motion-pure";
import { ORB_FRAG, ORB_VERT } from "./orb-shader";

export type OrbRenderer = { draw(u: OrbUniforms, tier: number): void; /** Last finished GPU time per frame (ms), or undefined (no timer / not ready). */ gpuMs(): number | undefined; resize(w: number, h: number): void; dispose(): void; gl: WebGL2RenderingContext };

const NAMES = ["uRes", "uSwirl", "uFlow", "uSpark", "uRing", "uCore", "uThreads", "uSparks", "uGlow", "uSat", "uBeat", "uPulse", "uRingGlow", "uScale", "uTier", "uLean", "uShake"] as const;

export function createOrbRenderer(canvas: HTMLCanvasElement, opts: { preserveDrawingBuffer?: boolean } = {}): OrbRenderer | null {
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power", preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
  } catch { gl = null; }
  if (!gl) return null;
  const sh = (type: number, src: string) => {
    const s = gl!.createShader(type);
    if (!s) return null;
    gl!.shaderSource(s, src); gl!.compileShader(s);
    if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) { console.warn("orb shader:", gl!.getShaderInfoLog(s)); gl!.deleteShader(s); return null; }
    return s;
  };
  const vs = sh(gl.VERTEX_SHADER, ORB_VERT), fs = sh(gl.FRAGMENT_SHADER, ORB_FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs); gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, "aPos");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn("orb program:", gl.getProgramInfoLog(prog)); return null; }
  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const loc = Object.fromEntries(NAMES.map((n) => [n, gl!.getUniformLocation(prog, n)])) as Record<(typeof NAMES)[number], WebGLUniformLocation | null>;
  gl.useProgram(prog);
  gl.disable(gl.BLEND);
  const g = gl;
  // GPU timer: one query in flight at a time; read it back a few frames later (never stalls the pipeline)
  type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
  const tx = g.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExt | null;
  let query: WebGLQuery | null = null, lastGpu: number | undefined;
  const poll = () => {
    if (!tx || !query) return;
    if (!g.getQueryParameter(query, g.QUERY_RESULT_AVAILABLE)) return;
    const disjoint = g.getParameter(tx.GPU_DISJOINT_EXT);
    const ns = g.getQueryParameter(query, g.QUERY_RESULT) as number;
    if (!disjoint) lastGpu = ns / 1e6;
    g.deleteQuery(query); query = null;
  };
  return {
    gl: g,
    resize(w, h) { if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } g.viewport(0, 0, w, h); },
    gpuMs() { const v = lastGpu; lastGpu = undefined; return v; },
    draw(u, tier) {
      poll();
      const timing = !!tx && !query;
      if (timing) { query = g.createQuery(); if (query) g.beginQuery(tx!.TIME_ELAPSED_EXT, query); }
      g.useProgram(prog); g.bindVertexArray(vao);
      g.uniform2f(loc.uRes, canvas.width, canvas.height);
      g.uniform1f(loc.uSwirl, u.swirl); g.uniform1f(loc.uFlow, u.flow); g.uniform1f(loc.uSpark, u.spark); g.uniform1f(loc.uRing, u.ring);
      g.uniform1f(loc.uCore, u.core); g.uniform1f(loc.uThreads, u.threads); g.uniform1f(loc.uSparks, u.sparks); g.uniform1f(loc.uGlow, u.glow);
      g.uniform1f(loc.uSat, u.sat); g.uniform1f(loc.uBeat, u.beat); g.uniform1f(loc.uPulse, u.pulse); g.uniform1f(loc.uRingGlow, u.ringGlow);
      g.uniform1f(loc.uScale, u.scale); g.uniform1f(loc.uTier, tier);
      g.uniform2f(loc.uLean, u.leanX, u.leanY); g.uniform2f(loc.uShake, u.shakeX, u.shakeY);
      g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
      g.drawArrays(g.TRIANGLES, 0, 3);
      if (timing && query) g.endQuery(tx!.TIME_ELAPSED_EXT);
    },
    dispose() { if (query) g.deleteQuery(query); g.deleteBuffer(buf); g.deleteVertexArray(vao); g.deleteProgram(prog); g.deleteShader(vs); g.deleteShader(fs); },
  };
}
