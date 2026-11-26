// The frame plate drawn with depth parallax: one textured quad, each pixel's uv shifted by its depth and the pointer offset.
// Returns null when WebGL or the depth map is missing; the caller then shows the flat picture.
import { easeOffset, shiftFor } from "@/lib/frame-parallax-pure";

const load = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });

const FS = `precision highp float; uniform sampler2D c, d; uniform vec2 o; uniform float k, t, sat, vig, tint; uniform vec4 st[3]; uniform vec3 sx[3]; varying vec2 v;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1., 0.)), f.x), mix(h(i + vec2(0., 1.)), h(i + vec2(1., 1.)), f.x), f.y); }
void main(){
  vec2 u0 = v; float calm = 0.;
  for (int i = 0; i < 3; i++) { // painted cyclones: turn slowly (two phases crossfaded so they never wind up) and morph a little; graded down
    vec4 a = st[i]; if (a.z < .001) continue;
    vec2 dd = (v - a.xy) * vec2(1.787, 1.); float q = length(dd) / a.z; if (q >= 1.) continue;
    float per = sx[i].x, ph = fract(t / per), ph2 = fract(ph + .5), wa = 1. - abs(2. * ph - 1.), an = a.w * 1.1 * (1. - smoothstep(.3, 1., q));
    float ca = cos(-ph * an), sa = sin(-ph * an), cb = cos(-ph2 * an), sb = sin(-ph2 * an);
    vec2 pa = a.xy + vec2(ca * dd.x - sa * dd.y, sa * dd.x + ca * dd.y) / vec2(1.787, 1.), pb = a.xy + vec2(cb * dd.x - sb * dd.y, sb * dd.x + cb * dd.y) / vec2(1.787, 1.);
    vec2 n = (vec2(vn(dd * 14. + t * .12), vn(dd * 14. + 9. - t * .1)) - .5) * .006 * (1. - q);
    float w = smoothstep(1., .75, q); u0 = mix(u0, mix(pb, pa, wa) + n, w); calm = max(calm, w * sx[i].y);
  }
  float z = texture2D(d, v).r - .5; vec2 u = clamp(u0 - o * z * k * 2., .002, .998);
  vec3 col = texture2D(c, u).rgb; float l = dot(col, vec3(.299, .587, .114));
  col = mix(vec3(l), col, sat * (1. - .65 * calm)); col *= 1. - .22 * calm;
  float mx = max(col.r, max(col.g, col.b)), sa = (mx - min(col.r, min(col.g, col.b))) / max(mx, .001); // the painted weather tint is the loud saturated colour: grade it down hard
  col = mix(col, vec3(l) * .92, tint * smoothstep(.28, .62, sa));
  col *= 1. - vig * smoothstep(.35, 1.0, length(v - .5) * 1.5);
  gl_FragColor = vec4(col, 1.);
}`;
export type PlateFx = { storms?: { x: number; y: number; r: number; dir: number; period: number }[]; sat?: number; vig?: number; calm?: number; tint?: number };
export async function createPlateGL(canvas: HTMLCanvasElement, src: string, depthSrc: string, strength: number, fx: PlateFx = {}): Promise<{ setTarget: (x: number, y: number) => void; dispose: () => void } | null> {
  let img: HTMLImageElement, dep: HTMLImageElement;
  try { [img, dep] = await Promise.all([load(src), load(depthSrc)]); } catch { return null; }
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
  if (!gl) return null;
  const sh = (t: number, s: string) => { const o = gl.createShader(t)!; gl.shaderSource(o, s); gl.compileShader(o); return o; };
  const pr = gl.createProgram()!;
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, "attribute vec2 p; varying vec2 v; void main(){ v = p*.5+.5; v.y = 1.-v.y; gl_Position = vec4(p,0.,1.); }"));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
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
  const uo = gl.getUniformLocation(pr, "o"), ut = gl.getUniformLocation(pr, "t");
  gl.uniform1f(gl.getUniformLocation(pr, "sat"), fx.sat ?? 1); gl.uniform1f(gl.getUniformLocation(pr, "vig"), fx.vig ?? 0); gl.uniform1f(gl.getUniformLocation(pr, "tint"), fx.tint ?? 0);
  const sts = new Float32Array(12), sxs = new Float32Array(9); (fx.storms ?? []).slice(0, 3).forEach((s, i) => { sts.set([s.x, s.y, s.r, s.dir], i * 4); sxs.set([s.period, fx.calm ?? 0.6, 0], i * 3); });
  gl.uniform4fv(gl.getUniformLocation(pr, "st"), sts); gl.uniform3fv(gl.getUniformLocation(pr, "sx"), sxs);
  const t00 = performance.now();
  let cur: [number, number] = [0, 0], tgt: [number, number] = [0, 0], raf = 0, last = performance.now(), dead = false;
  const draw = (now: number) => {
    if (dead) return;
    cur = easeOffset(cur, tgt, (now - last) / 1000); last = now;
    gl.viewport(0, 0, canvas.width, canvas.height); gl.uniform2f(uo, cur[0], cur[1]); gl.uniform1f(ut, (now - t00) / 1000); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  void shiftFor; // the shader does the same arithmetic as shiftFor (tested in tests/frame-map.test.ts)
  return { setTarget: (x, y) => { tgt = [x, y]; }, dispose: () => { dead = true; cancelAnimationFrame(raf); gl.deleteTexture(t0); gl.deleteTexture(t1); gl.deleteBuffer(buf); gl.deleteProgram(pr); gl.getExtension("WEBGL_lose_context")?.loseContext(); } };
}
