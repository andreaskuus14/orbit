// Estonia close-up layer (feat/earth-estonia-real): real places instead of boxes. Per z15 tile: the Land Board orthophoto
// (0.3-0.6 m/px) as the ground, their LOD2 buildings with real roof shapes (roofs textured with the same photo from above, walls
// in plaster tones with windows, lit by the real sun, windows and street light after dark), and trees standing where the photo
// shows tree crowns. Loads nearest first within a triangle and texture budget, fades out above EE_MAX_ALT, and stays off
// outside Estonia (the OSM layer keeps working there). Plus the thin map HUD of the close-up: compass, altitude scale, scale bar
// and a coordinates bar. Hooked into earth-scene.ts with one call per frame; pure maths in src/lib/earth-ee3d-pure.ts.
import * as THREE from "three";
import { LIGHT_GLSL } from "@/lib/earth-light-pure";
import { lat2y, lon2x, x2lon, y2lat, toXYZ, type Pose } from "@/lib/earth-pure";
import { ATTRIBUTION, EE_FULL, EE_MAX_ALT, EZ, TRI_BUDGET, decodeMesh, eeTilesAround, inEstonia, orthoTiles, tileMetres, tris, type EMesh } from "@/lib/earth-ee3d-pure";
import { coveredRadius, treeSpots, wallTint } from "@/lib/earth-ee3d-look-pure";

export type EeOpts = {
  scene: THREE.Scene; hud: HTMLElement; sun: THREE.Vector3; camU: { value: THREE.Vector3 };
  groundAt: (lon: number, lat: number) => number; // metres, the scene's terrain surface
  meshUrl: (x: number, y: number) => string; orthoUrl: (z: number, x: number, y: number) => string;
  maxTiles?: number; // lower for headless stills on a small box
};
const R = 6371000;
const LOG = `#include <common>\n#include <logdepthbuf_pars_vertex>\n`, LOGF = `#include <logdepthbuf_pars_fragment>\n`;

// shared: fade the layer's edge (circle around the camera target) and the distance haze, like the scene's other close-up layers
const EDGE = `uniform vec3 uC; uniform float uR; uniform vec3 uCam; uniform float uOp;
float edgeK(vec3 w){ return 1. - smoothstep(uR * .55, uR, length(w - uC)); }
float dither(vec2 p){ p = floor(p * .5); return fract(52.9829189 * fract(dot(p, vec2(.06711056, .00583715)))); }
vec3 haze(vec3 c, vec3 w, float lit){ float d = length(uCam - w) * 6371.; return mix(c, vec3(.33,.4,.5) * mix(.08, .9, lit), (1. - exp(-d * .09)) * .45); }`;

const gVS = `${LOG} varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; \n#include <logdepthbuf_vertex>\n }`;
const gFS = `${LOGF}${LIGHT_GLSL}${EDGE} uniform sampler2D uMap; uniform vec3 uSun; varying vec2 vUv; varying vec3 vW;
void main(){ \n#include <logdepthbuf_fragment>\n
  vec4 t = texture2D(uMap, vUv); if (t.a < .5) discard;
  vec3 c = pow(t.rgb, vec3(2.2)); vec3 up = normalize(vW); float s = dot(up, uSun), lit = dayK(s), on = lightsK(s), dusk = duskK(s);
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float paved = (1. - smoothstep(.05, .12, mx - mn)) * smoothstep(.04, .12, mx); // grey, mid-bright: asphalt and stone paving
  vec3 day = c * (.42 + .5 * sqrt(max(s, 0.))) * mix(vec3(1.), vec3(1.15,.82,.62), dusk * .7);
  vec3 night = c * .05 + vec3(.002,.003,.006) + vec3(.006,.009,.02) * dusk + SODIUM * paved * .11 * on;
  c = haze(mix(night, day, lit), vW, lit);
  gl_FragColor = vec4(c, uOp * edgeK(vW)); }`;

const bVS = `${LOG} attribute vec2 uvm; attribute vec4 nk; attribute vec3 tint; attribute vec3 wall; varying vec2 vUv; varying vec3 vN; varying float vRoof; varying vec3 vTint; varying vec3 vWall; varying vec3 vW;
void main(){ vUv = uvm; vN = nk.xyz; vRoof = nk.w; vTint = tint; vWall = wall; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; \n#include <logdepthbuf_vertex>\n }`;
const bFS = `${LOGF}${LIGHT_GLSL}${EDGE} uniform sampler2D uMap; uniform vec3 uSun; varying vec2 vUv; varying vec3 vN; varying float vRoof; varying vec3 vTint; varying vec3 vWall; varying vec3 vW;
float hb(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){ \n#include <logdepthbuf_fragment>\n
  if (edgeK(vW) < dither(gl_FragCoord.xy)) discard;
  vec3 up = normalize(vW); float s = dot(up, uSun), lit = dayK(s), on = lightsK(s), dusk = duskK(s);
  vec3 N = normalize(vN); float diff = max(dot(N, uSun), 0.), sky = .5 + .5 * dot(N, up);
  vec3 sunC = mix(vec3(1.,.97,.92), vec3(1.,.58,.32), dusk);
  float roof = step(.5, vRoof);
  vec3 photo = pow(texture2D(uMap, vUv).rgb, vec3(2.2));
  // roofs: the photo seen from above, a little cleaner; walls: plaster with a darker base, windows from the first floor up
  vec3 alb = mix(vTint, photo * 1.05, roof);
  float bay = 2.8 + 1.2 * fract(vTint.r * 37.1 + vTint.b * 11.3); // each building its own window rhythm
  vec2 g = vec2(vWall.x / bay, vWall.y / 3.2), f = fract(g), id = floor(g);
  float win = (1. - smoothstep(.12, .3, max(fwidth(g.x), fwidth(g.y)))) * (1. - roof) * step(.34, f.x) * step(f.x, .66) * step(.3, f.y) * step(f.y, .74) * step(1., id.y) * step(vWall.y + 1.2, vWall.z) * step(4., vWall.z);
  alb = mix(alb, vec3(.05,.055,.065), win * .6);
  alb *= mix(.55, 1., smoothstep(0., 2.5, vWall.y) * (1. - roof) + roof);
  float wl = mix(1.25, 1., roof); // walls a touch brighter: plaster in sun
  vec3 c = alb * wl * (sky * (mix(.03, .3, lit) + .12 * dusk) * mix(vec3(1.), vec3(.8,.88,1.08), 1. - roof) + diff * .9 * lit * sunC);
  c += vec3(.03,.045,.07) * win * lit * sky; // glass reflects the sky
  float r = hb(id + vec2(floor(vWall.z * 7.), vTint.r * 91.));
  vec3 wc = mix(vec3(1.,.6,.3), vec3(1.,.8,.55), hb(id + 3.1)) * (.4 + .6 * hb(id + 9.7));
  c += wc * win * step(1. - mix(.05, .6, on), r) * mix(.05, 1.1, on);
  c = mix(c, alb * .03 + vec3(.002,.003,.006), (1. - lit) * (1. - dusk) * .85 * (1. - win)); // dark after sunset, lit windows stay
  c += SODIUM * .05 * on * (1. - roof) * (1. - smoothstep(0., 7., vWall.y)); // street light on the ground floors
  gl_FragColor = vec4(haze(c, vW, lit), uOp); }`;

const tVS = `${LOG} attribute vec3 tcol; varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying float vY;
void main(){ vCol = tcol; vY = position.y; vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.); vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal); gl_Position = projectionMatrix*viewMatrix*w; \n#include <logdepthbuf_vertex>\n }`;
const tFS = `${LOGF}${LIGHT_GLSL}${EDGE} uniform vec3 uSun; varying vec3 vCol; varying vec3 vN; varying vec3 vW; varying float vY;
void main(){ \n#include <logdepthbuf_fragment>\n
  if (edgeK(vW) < dither(gl_FragCoord.xy)) discard;
  vec3 up = normalize(vW); float s = dot(up, uSun), lit = dayK(s), dusk = duskK(s);
  vec3 N = normalize(vN); float diff = max(dot(N, uSun), 0.) * .8 + .2, sky = .55 + .45 * dot(N, up);
  vec3 c = vCol * (sky * .35 + diff * 1.1 * mix(vec3(1.), vec3(1.,.6,.35), dusk)) * mix(.55, 1., vY); // darker toward the trunk
  c = mix(c * .04 + vec3(.001,.002,.004), c, lit);
  gl_FragColor = vec4(haze(c, vW, lit), uOp); }`;

type T = { x: number; y: number; z: number; o: THREE.Vector3; ground?: THREE.Mesh; bld?: THREE.Mesh; trees?: THREE.InstancedMesh; tex?: THREE.Texture; tris: number; state: "loading" | "ready" | "wait"; retry: number; mesh?: EMesh };

export function createEe3d(o: EeOpts) {
  const shared = { uSun: { value: o.sun }, uCam: o.camU, uC: { value: new THREE.Vector3() }, uR: { value: 1 }, uOp: { value: 0 } };
  const tiles = new Map<string, T>();
  const crown = new THREE.IcosahedronGeometry(1, 1); crown.translate(0, 1, 0); // unit crown, base at 0
  const tMat = new THREE.ShaderMaterial({ vertexShader: tVS, fragmentShader: tFS, uniforms: { ...shared }, transparent: true });
  let busy = 0, last = 0, k = 0;

  /* HUD: compass, altitude scale, scale bar, coordinates; credit */
  const hud = document.createElement("div"); hud.className = "ee-hud"; o.hud.appendChild(hud);
  hud.innerHTML = `<div class="ee-compass"><svg viewBox="-30 -30 60 60"><circle r="24"/><path d="M0-18 5 4 0 0-5 4Z"/><text y="-25">N</text></svg></div>
<div class="ee-alt"><span class="ee-alt-k">ALT</span><div class="ee-alt-bar"></div><b class="ee-alt-v"></b></div>
<div class="ee-scale"><i></i><span></span></div><div class="ee-coords"></div><div class="ee-credit">${ATTRIBUTION}</div>`;
  const q = (c: string) => hud.querySelector(c) as HTMLElement;
  const compass = q(".ee-compass svg"), altBar = q(".ee-alt-bar"), altV = q(".ee-alt-v"), scaleI = q(".ee-scale i"), scaleS = q(".ee-scale span"), coords = q(".ee-coords");
  altBar.innerHTML = [2000, 1000, 500, 250, 100, 0].map((m) => `<em style="top:${(100 * (1 - altPos(m))).toFixed(1)}%">${m >= 1000 ? `${m / 1000} km` : `${m} m`}</em>`).join("");
  function altPos(m: number) { return Math.log1p(m / 50) / Math.log1p(4000 / 50); }

  function drop(t: T) {
    for (const m of [t.ground, t.bld, t.trees]) if (m) { o.scene.remove(m); m.geometry.dispose(); if (m !== t.trees) (m.material as THREE.Material).dispose(); }
    t.tex?.dispose(); t.ground = t.bld = t.trees = t.tex = undefined;
  }
  const img = (u: string) => new Promise<HTMLImageElement | null>((ok) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = () => ok(null); i.src = u; });

  async function load(t: T) {
    busy++; t.state = "loading";
    try {
      const { x0, y0, n } = orthoTiles(t.x, t.y, t.z), S = 256, cv = document.createElement("canvas"); cv.width = cv.height = n * S;
      const g = cv.getContext("2d", { willReadFrequently: true })!;
      const [meshR] = await Promise.all([
        t.mesh ? Promise.resolve(null) : fetch(o.meshUrl(t.x, t.y)),
        Promise.all(Array.from({ length: n * n }, async (_, i) => { const im = await img(o.orthoUrl(t.z, x0 + (i % n), y0 + Math.floor(i / n))); if (im) g.drawImage(im, (i % n) * S, Math.floor(i / n) * S, S, S); })),
      ]);
      if (meshR) {
        if (meshR.status === 202) { t.state = "wait"; t.retry = performance.now() + 4000; return; } // the server is preparing this town
        if (!meshR.ok) { t.state = "wait"; t.retry = performance.now() + 600_000; return; }
        t.mesh = decodeMesh(await meshR.arrayBuffer()) ?? undefined;
      }
      if (!tiles.has(`${t.x}/${t.y}`)) return;
      drop(t); build(t, cv); t.state = "ready";
    } catch { t.state = "wait"; t.retry = performance.now() + 60_000; } finally { busy--; }
  }

  function build(t: T, cv: HTMLCanvasElement) {
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; t.tex = tex;
    tex.onUpdate = () => { cv.width = cv.height = 1; }; // once on the GPU, free the canvas (up to 16 MB)
    const px = cv.getContext("2d")!.getImageData(0, 0, cv.width, cv.height), W = cv.width;
    const uvOf = (lon: number, lat: number): [number, number] => [lon2x(lon, EZ) - t.x, 1 - (lat2y(lat, EZ) - t.y)];
    const at = (lon: number, lat: number, h: number) => { const p = toXYZ(lon, lat, h / R); return [p[0] - t.o.x, p[1] - t.o.y, p[2] - t.o.z]; };
    // ground: 32×32 grid on the scene's terrain
    { const seg = 32, n = seg + 1, pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), idx: number[] = [];
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const lo = x2lon(t.x + i / seg, EZ), la = y2lat(t.y + j / seg, EZ), q = j * n + i; pos.set(at(lo, la, o.groundAt(lo, la) + 1.5), q * 3); uv.set([i / seg, 1 - j / seg], q * 2); }
      for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) { const a = j * n + i; idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1); }
      const gg = new THREE.BufferGeometry(); gg.setAttribute("position", new THREE.BufferAttribute(pos, 3)); gg.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); gg.setIndex(idx); gg.computeBoundingSphere();
      t.ground = new THREE.Mesh(gg, new THREE.ShaderMaterial({ vertexShader: gVS, fragmentShader: gFS, uniforms: { ...shared, uMap: { value: tex } }, transparent: true, depthTest: false, depthWrite: false }));
      t.ground.position.copy(t.o); t.ground.renderOrder = 7; o.scene.add(t.ground); }
    // buildings
    const m = t.mesh, roofMask = new Uint8Array(W * W);
    if (m && m.nB) {
      const nV = m.pos.length / 3, pos = new Float32Array(nV * 3), uvm = new Float32Array(nV * 2), nk = new Float32Array(nV * 4), tint = new Float32Array(nV * 3), wall = new Float32Array(nV * 3);
      const kx = (Math.PI / 180) * R * Math.cos((m.lat * Math.PI) / 180), ky = (Math.PI / 180) * R;
      const la = (m.lat * Math.PI) / 180, lo = (m.lon * Math.PI) / 180;
      const E = [Math.cos(lo), 0, -Math.sin(lo)], Nn = [-Math.sin(la) * Math.sin(lo), Math.cos(la), -Math.sin(la) * Math.cos(lo)], U = toXYZ(m.lon, m.lat);
      for (let b = 0; b < m.nB; b++) {
        const v0 = m.bStart[b], v1 = b + 1 < m.nB ? m.bStart[b + 1] : nV;
        const cx = m.bld[b * 3], cy = m.bld[b * 3 + 1], g0 = o.groundAt(m.lon + cx / kx, m.lat + cy / ky) + 1.5;
        let H = 0; for (let v = v0; v < v1; v++) H = Math.max(H, m.pos[v * 3 + 2]);
        const tc = wallTint(b * 7919 + Math.round(cx * 13 + cy * 7), H);
        for (let v = v0; v < v1; v++) {
          const e = m.pos[v * 3], nn = m.pos[v * 3 + 1], u = m.pos[v * 3 + 2], lon = m.lon + e / kx, lat = m.lat + nn / ky;
          pos.set(at(lon, lat, g0 + u), v * 3); uvm.set(uvOf(lon, lat), v * 2);
          const nx = m.nrm[v * 4] / 127, ny = m.nrm[v * 4 + 1] / 127, nz = m.nrm[v * 4 + 2] / 127;
          nk.set([nx * E[0] + ny * Nn[0] + nz * U[0], nx * E[1] + ny * Nn[1] + nz * U[1], nx * E[2] + ny * Nn[2] + nz * U[2], m.nrm[v * 4 + 3]], v * 4);
          tint.set(tc, v * 3); wall.set([e * -ny + nn * nx, u, H], v * 3);
          if (m.nrm[v * 4 + 3]) { const [a, c] = uvOf(lon, lat); const X = Math.floor(a * W), Y = Math.floor((1 - c) * W); for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const xx = X + dx, yy = Y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < W) roofMask[yy * W + xx] = 1; } }
        }
      }
      // fill roof footprints in the mask from the triangles (so trees never grow out of roofs)
      for (let i = 0; i < m.idx.length; i += 3) {
        const a = m.idx[i], b = m.idx[i + 1], c = m.idx[i + 2]; if (!m.nrm[a * 4 + 3]) continue;
        const P = [a, b, c].map((v) => [uvm[v * 2] * W, (1 - uvm[v * 2 + 1]) * W]);
        const x0 = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0]))), y0 = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), y1 = Math.min(W - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
        if ((x1 - x0) * (y1 - y0) > 400000) continue;
        const cr = (p: number[], q: number[], x: number, y: number) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const s0 = cr(P[0], P[1], x, y), s1 = cr(P[1], P[2], x, y), s2 = cr(P[2], P[0], x, y); if ((s0 >= -60 && s1 >= -60 && s2 >= -60) || (s0 <= 60 && s1 <= 60 && s2 <= 60)) roofMask[y * W + x] = 1; }
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute("position", new THREE.BufferAttribute(pos, 3)); bg.setAttribute("uvm", new THREE.BufferAttribute(uvm, 2)); bg.setAttribute("nk", new THREE.BufferAttribute(nk, 4));
      bg.setAttribute("tint", new THREE.BufferAttribute(tint, 3)); bg.setAttribute("wall", new THREE.BufferAttribute(wall, 3)); bg.setIndex(new THREE.BufferAttribute(m.idx, 1)); bg.computeBoundingSphere();
      for (const a of [...Object.values(bg.attributes), bg.index!]) (a as THREE.BufferAttribute).onUpload(function (this: THREE.BufferAttribute) { (this as { array: unknown }).array = null; }); // JS copies are not needed once on the GPU
      t.mesh = undefined;
      t.bld = new THREE.Mesh(bg, new THREE.ShaderMaterial({ vertexShader: bVS, fragmentShader: bFS, uniforms: { ...shared, uMap: { value: tex } }, transparent: true, side: THREE.DoubleSide }));
      t.bld.position.copy(t.o); t.bld.renderOrder = 8; o.scene.add(t.bld);
    }
    // trees where the photo shows crowns
    const spots = treeSpots(px.data, W, roofMask, t.z === 18 ? 10 : 5, tileMetres(y2lat(t.y + 0.5, EZ)) / W);
    if (spots.length) {
      const im = new THREE.InstancedMesh(crown, tMat, spots.length), mt = new THREE.Matrix4(), col = new Float32Array(spots.length * 3), q = new THREE.Quaternion(), up = new THREE.Vector3();
      spots.forEach((s, i) => {
        const lon = x2lon(t.x + s.u, EZ), lat = y2lat(t.y + s.v, EZ), p = at(lon, lat, o.groundAt(lon, lat) + 1.5);
        up.set(...toXYZ(lon, lat)).normalize(); q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
        const sc = new THREE.Vector3(s.r / R, (s.h / 2) / R, s.r / R); mt.compose(new THREE.Vector3(p[0], p[1], p[2]), q, sc); im.setMatrixAt(i, mt); col.set(s.c, i * 3);
      });
      im.geometry = crown.clone(); im.geometry.setAttribute("tcol", new THREE.InstancedBufferAttribute(col, 3));
      im.position.copy(t.o); im.renderOrder = 8; im.frustumCulled = false; o.scene.add(im); t.trees = im;
    }
    t.tris = (m ? tris(m) : 0) + spots.length * 80 + 2048;
  }

  function update(p: Pose): number {
    const want = inEstonia(p.lon, p.lat) ? eeTilesAround(p.lon, p.lat, p.alt).slice(0, o.maxTiles ?? 99) : [];
    const target = want.length ? Math.min(1, Math.max(0, (EE_MAX_ALT - p.alt) / (EE_MAX_ALT - EE_FULL))) : 0;
    const centre = want[0] && tiles.get(`${want[0].x}/${want[0].y}`);
    k += ((centre?.state === "ready" ? target : 0) - k) * 0.12; if (k < 0.002) k = 0;
    shared.uOp.value = Math.min(1, k * 1.15);
    shared.uC.value.set(...toXYZ(p.lon, p.lat, o.groundAt(p.lon, p.lat) / R)); // on the (raised) ground, not at sea level
    shared.uR.value = (Math.min(Math.max(0.9, Math.min(2.6, 0.6 + p.alt * 0.95)) * 1000, coveredM(p)) ) / R;
    for (const t of tiles.values()) for (const m of [t.ground, t.bld, t.trees]) if (m) m.visible = k > 0.01;
    hud.style.opacity = String(k);
    if (k > 0.01) hudFrame(p);
    const now = performance.now();
    if (now - last > 300) {
      last = now;
      let tri = 0; const keep = new Set<string>();
      for (const w of want) {
        const key = `${w.x}/${w.y}`; let t = tiles.get(key);
        if (!t) { const c = toXYZ(x2lon(w.x + 0.5, EZ), y2lat(w.y + 0.5, EZ)); t = { x: w.x, y: w.y, z: w.z, o: new THREE.Vector3(...c), tris: 0, state: "wait", retry: 0 }; tiles.set(key, t); }
        if (tri + t.tris > TRI_BUDGET) break; tri += t.tris; keep.add(key);
        const sharper = w.z > t.z && t.state === "ready";
        if (busy < 3 && ((t.state === "wait" && t.retry < now) || sharper)) { t.z = Math.max(t.z, w.z); void load(t); }
      }
      if (tiles.size > keep.size + (o.maxTiles ? 0 : 8)) for (const [key, t] of tiles) if (!keep.has(key) && t.state !== "loading") { drop(t); tiles.delete(key); }
    }
    return k;
  }

  /** Radius (m) around the camera target inside which every tile is loaded, so the soft edge never shows a square hole. */
  function coveredM(p: Pose) {
    const ready = (x: number, y: number) => tiles.has(`${x}/${y}`); // wanted tiles (loading ones still count: no shrinking while they come)
    return coveredRadius(lon2x(p.lon, EZ), lat2y(p.lat, EZ), ready) * tileMetres(p.lat);
  }
  let fitAt = 0;
  /** Keeps the HUD inside the Intelligence stage (.intel-stage: the free area between the bars and panels), when there is one. */
  function fitStage() {
    const now = performance.now(); if (now - fitAt < 500) return; fitAt = now;
    const st = document.querySelector(".intel-stage")?.getBoundingClientRect(), hb = o.hud.getBoundingClientRect();
    const b = st && st.width > 0 ? [st.top - hb.top, hb.right - st.right, hb.bottom - st.bottom, st.left - hb.left].map((v) => Math.max(0, v)) : [0, 0, 0, 0];
    Object.assign(hud.style, { top: `${b[0]}px`, right: `${b[1]}px`, bottom: `${b[2]}px`, left: `${b[3]}px` });
  }
  function hudFrame(p: Pose) {
    fitStage();
    compass.style.transform = `rotate(${-(p.heading ?? 0)}deg)`;
    const m = p.alt * 1000; altV.textContent = m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`; altV.style.top = `${(100 * (1 - Math.min(1, altPos(m)))).toFixed(1)}%`;
    // scale bar: ~ metres per px at the screen centre (34° fov, 720-1440 px tall), rounded to 1/2/5
    const mpp = (2 * m * Math.tan((17 * Math.PI) / 180)) / (o.hud.clientHeight || 720) / Math.cos(((p.tilt ?? 0) * Math.PI) / 360);
    const nice = [10, 20, 50, 100, 200, 250, 500, 1000, 2000].reduce((b, v) => (v / mpp <= 160 ? v : b), 10);
    scaleI.style.width = `${(nice / mpp).toFixed(0)}px`; scaleS.textContent = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`;
    coords.textContent = `${p.lat.toFixed(4)}° N  ${p.lon.toFixed(4)}° E   ${p.heading ? `heading ${Math.round(((p.heading % 360) + 360) % 360)}°` : ""}`;
  }

  return {
    update,
    /** Tiles still loading (stills script). */
    loading: () => busy + [...tiles.values()].filter((t) => t.state === "wait" && t.retry < performance.now() + 5000 && !t.ground).length,
    dispose() { for (const t of tiles.values()) drop(t); tiles.clear(); crown.dispose(); tMat.dispose(); hud.remove(); },
  };
}

export const EE3D_CSS = `
.ee-hud{position:absolute;inset:0;pointer-events:none;color:#cfefff;font:500 11px/1.2 var(--font-jetbrains,ui-monospace,monospace);transition:opacity .4s}
.ee-compass{position:absolute;left:16px;top:16px;width:56px;height:56px}
.ee-compass svg{width:100%;height:100%;overflow:visible;transition:transform .2s}
.ee-compass circle{fill:rgba(2,10,18,.45);stroke:rgba(120,220,255,.65);stroke-width:1}
.ee-compass path{fill:#7fe3ff}.ee-compass text{fill:#cfefff;font-size:9px;text-anchor:middle}
.ee-alt{position:absolute;left:16px;top:104px;height:min(300px,calc(100% - 170px));width:70px}
.ee-alt-k{position:absolute;top:-16px;left:0;color:rgba(207,239,255,.7)}
.ee-alt-bar{position:absolute;left:8px;top:0;bottom:0;border-left:1px solid rgba(120,220,255,.55)}
.ee-alt-bar em{position:absolute;left:0;font-style:normal;transform:translateY(-50%);padding-left:12px;color:rgba(207,239,255,.65);white-space:nowrap}
.ee-alt-bar em:before{content:"";position:absolute;left:0;top:50%;width:7px;border-top:1px solid rgba(120,220,255,.55)}
.ee-alt-v{position:absolute;left:14px;transform:translateY(-50%);padding:2px 6px;border:1px solid #7fe3ff;background:rgba(2,10,18,.6);color:#eafaff;white-space:nowrap}
.ee-scale{position:absolute;left:50%;bottom:30px;transform:translateX(-50%);text-align:center}
.ee-scale i{display:block;height:6px;border:1px solid rgba(120,220,255,.8);border-top:0;margin:0 auto 3px}
.ee-coords{position:absolute;left:16px;bottom:10px;color:rgba(207,239,255,.8)}
.ee-credit{position:absolute;right:calc(var(--pr,0px) + 10px);bottom:16px;font-size:9px;color:rgba(238,242,247,.55)}
`;
