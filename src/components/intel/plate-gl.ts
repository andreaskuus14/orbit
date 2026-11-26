// The frame plate drawn with depth parallax: one textured quad, each pixel's uv shifted by its depth and the pointer offset.
// Returns null when WebGL or the depth map is missing; the caller then shows the flat picture.
import { easeOffset, shiftFor } from "@/lib/frame-parallax-pure";

const load = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });

export async function createPlateGL(canvas: HTMLCanvasElement, src: string, depthSrc: string, strength: number): Promise<{ setTarget: (x: number, y: number) => void; dispose: () => void } | null> {
  let img: HTMLImageElement, dep: HTMLImageElement;
  try { [img, dep] = await Promise.all([load(src), load(depthSrc)]); } catch { return null; }
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
  if (!gl) return null;
  const sh = (t: number, s: string) => { const o = gl.createShader(t)!; gl.shaderSource(o, s); gl.compileShader(o); return o; };
  const pr = gl.createProgram()!;
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, "attribute vec2 p; varying vec2 v; void main(){ v = p*.5+.5; v.y = 1.-v.y; gl_Position = vec4(p,0.,1.); }"));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, "precision mediump float; uniform sampler2D c, d; uniform vec2 o; uniform float k; varying vec2 v; void main(){ float z = texture2D(d, v).r - .5; vec2 u = clamp(v - o*z*k*2., .002, .998); gl_FragColor = texture2D(c, u); }"));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
  gl.useProgram(pr);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = (unit: number, im: HTMLImageElement) => {
    const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t;
  };
  const t0 = tex(0, img), t1 = tex(1, dep);
  gl.uniform1i(gl.getUniformLocation(pr, "c"), 0); gl.uniform1i(gl.getUniformLocation(pr, "d"), 1); gl.uniform1f(gl.getUniformLocation(pr, "k"), strength);
  const uo = gl.getUniformLocation(pr, "o");
  let cur: [number, number] = [0, 0], tgt: [number, number] = [0, 0], raf = 0, last = performance.now(), dead = false;
  const draw = (now: number) => {
    if (dead) return;
    cur = easeOffset(cur, tgt, (now - last) / 1000); last = now;
    gl.viewport(0, 0, canvas.width, canvas.height); gl.uniform2f(uo, cur[0], cur[1]); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  void shiftFor; // the shader does the same arithmetic as shiftFor (tested in tests/frame-map.test.ts)
  return { setTarget: (x, y) => { tgt = [x, y]; }, dispose: () => { dead = true; cancelAnimationFrame(raf); gl.deleteTexture(t0); gl.deleteTexture(t1); gl.deleteBuffer(buf); gl.deleteProgram(pr); gl.getExtension("WEBGL_lose_context")?.loseContext(); } };
}
