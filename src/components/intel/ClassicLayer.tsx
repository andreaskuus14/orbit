"use client";
// Classic map v2: a photoreal Earth (the Earth view's free tiles: Sentinel-2 cloudless by EOX, NASA Black Marble) with live
// day/night and drifting clouds, and a calm news layer on top: soft region-coloured "news weather" halos with a ring sized
// by story count, and thin arcs between countries that share stories. Frame: NewsGlobe's toVec (lon = atan2(-z, x)).
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { CLOUD, NOISE, mosaic } from "../earth/earth-tiles";
import { ringSize, sunAt } from "@/lib/classic-map-pure";

export type Spot = { name: string; lat: number; lon: number; count: number; color: string };

export function toVec(lat: number, lon: number, r: number) {
  const phi = ((90 - lat) * Math.PI) / 180, theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

const tileUrl = (k: string, z: number, x: number, y: number) => `/api/earth/tile?k=${k}&z=${z}&x=${x}&y=${y}`;
const WORLD = { w: -180, e: 180, n: 85.05, s: -85.05 };
const blank = (c: string) => { const k = document.createElement("canvas"); k.width = k.height = 2; const g = k.getContext("2d")!; g.fillStyle = c; g.fillRect(0, 0, 2, 2); return new THREE.CanvasTexture(k); };
const tex = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };

const VS = "varying vec3 vP; varying vec3 vW; varying vec3 vNw; void main(){ vP = normalize(position); vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; vNw = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w; }";
const EARTH_FS = `uniform sampler2D uDay; uniform sampler2D uNight; uniform vec3 uSun; uniform float uT; uniform float uDim; varying vec3 vP; varying vec3 vW; varying vec3 vNw; ${NOISE} ${CLOUD}
float mercV(float lat){ float l = clamp(lat, -1.4844, 1.4844); return (1. - log(tan(l) + 1./cos(l)) / 3.14159265) / 2.; }
void main(){
  float lon = atan(-vP.z, vP.x), lat = asin(clamp(vP.y, -1., 1.));
  vec2 uv = vec2(lon/6.2831853 + .5, 1. - mercV(lat));
  vec3 day = texture2D(uDay, uv).rgb, night = texture2D(uNight, uv).rgb;
  day = mix(day, vec3(.86,.9,.95), smoothstep(1.45, 1.52, abs(lat)));
  float d = dot(vP, uSun), lit = smoothstep(-.1, .22, d);
  vec3 cp = vec3(vP.x, vP.y, -vP.z); // clouds in the Earth view's frame, so they look the same
  float cl = cloudAt(cp, uT), sh = 1. - .4 * cloudAt(normalize(cp + uSun*.012), uT) * lit;
  float lum = dot(day, vec3(.299,.587,.114));
  day = mix(vec3(lum), day, .82) * vec3(.9,.97,1.08); // a touch cooler and calmer than the Earth view: news sits on top
  vec3 c = day * sh * (.1 + .78*sqrt(max(d, 0.))) * mix(.22, 1., lit) + day * .045 * (1. - lit);
  vec3 nl = clamp((night - .004) * 16., 0., 1.); nl *= nl; // Black Marble tiles are dim: lift the cities, keep the dark land dark
  c += nl * vec3(1.,.72,.38) * 1.3 * (1. - smoothstep(-.2, .06, d));
  c = mix(c, vec3(1.) * (.05 + .9*lit), cl * .8);
  vec3 V = normalize(cameraPosition - vW); float fr = pow(1. - max(dot(vNw, V), 0.), 2.6);
  c += fr * vec3(.35,.6,1.) * (.12 + .7*lit);
  gl_FragColor = vec4(c * uDim, 1.); }`;
const ATMO_FS = `uniform vec3 uSun; varying vec3 vP; varying vec3 vW; varying vec3 vNw;
void main(){ vec3 V = normalize(cameraPosition - vW); float i = pow(clamp(-dot(vNw, V) * 2.2, 0., 1.), 3.) * .9; // brightest at the limb, gone at the shell edge
  float lit = smoothstep(-.35, .35, dot(vP, uSun)); vec3 sky = mix(vec3(1.,.55,.3), vec3(.35,.62,1.), smoothstep(-.05,.3, dot(vP, uSun)));
  gl_FragColor = vec4(sky * i * (.08 + 1.1*lit), i * (.08 + lit)); }`;

/** The photoreal Earth material: a low-res picture first, the sharp Sentinel-2 / Black Marble mosaics when they arrive. */
export function useEarthMaterial(radius: number) {
  const u = useMemo(() => ({ uDay: { value: blank("#0b1b33") as THREE.Texture }, uNight: { value: blank("#000") as THREE.Texture }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uT: { value: 0 }, uDim: { value: 1 } }), []);
  const mat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: EARTH_FS, uniforms: u }), [u]);
  const atmo = useMemo(() => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: ATMO_FS, uniforms: { uSun: u.uSun }, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), [u]);
  useEffect(() => {
    let gone = false, sharp = false;
    const set = (k: "uDay" | "uNight", c: HTMLCanvasElement) => { if (gone) return; const old = u[k].value; u[k].value = tex(c); old.dispose(); };
    void mosaic({ tileUrl }, "day", WORLD, 2).then((m) => { if (!sharp) set("uDay", m.canvas); });
    void mosaic({ tileUrl }, "day", WORLD, 4).then((m) => { sharp = true; set("uDay", m.canvas); });
    void mosaic({ tileUrl }, "night", WORLD, 4).then((m) => set("uNight", m.canvas));
    return () => { gone = true; mat.dispose(); atmo.dispose(); u.uDay.value.dispose(); u.uNight.value.dispose(); };
  }, [u, mat, atmo]);
  useFrame(({ clock }) => {
    const s = sunAt(Date.now());
    u.uSun.value.copy(toVec(s.lat, s.lon, 1));
    u.uT.value = clock.elapsedTime;
  });
  void radius;
  return { mat, atmo, u };
}

const HALO_FS = `uniform vec3 uC; uniform float uT; uniform float uPh; uniform float uOn; uniform float uFade; varying vec2 vUv;
void main(){ float r = length(vUv - .5) * 2.; if (r > 1.) discard;
  float glow = exp(-r*r*4.) * .32;                       // soft weather wash
  float ring = exp(-pow((r - .42) * 30., 2.)) * .55;    // the size ring
  float w = fract(uT * .22 + uPh); float wave = exp(-pow((r - .42 - w*.55) * 30., 2.)) * (1. - w) * .5; // a slow ripple outward
  float core = exp(-r*r*1400.) * 1.1;
  float a = (glow + ring * (.6 + .4*uOn) + wave + core) * uFade;
  gl_FragColor = vec4(mix(uC, vec3(1.), core*.6 + ring*.15) , clamp(a, 0., 1.)); }`;
const haloGeo = new THREE.PlaneGeometry(1, 1);

/** One halo per hotspot: wash + ring sized by story count + slow ripple; the hovered/selected one brightens. */
export function Halos({ spots, R, reduced, focus }: { spots: Spot[]; R: number; reduced: boolean; focus: string | null }) {
  const max = Math.max(1, ...spots.map((s) => s.count));
  return <>{spots.map((s, i) => <Halo key={s.name} s={s} R={R} size={ringSize(s.count, max) * R * 2.4} ph={i * 0.137} reduced={reduced} on={focus === s.name} />)}</>;
}
function Halo({ s, R, size, ph, reduced, on }: { s: Spot; R: number; size: number; ph: number; reduced: boolean; on: boolean }) {
  const { pos, q } = useMemo(() => {
    const p = toVec(s.lat, s.lon, R * 1.004);
    return { pos: p, q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.clone().normalize()) };
  }, [s.lat, s.lon, R]);
  const mat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }", fragmentShader: HALO_FS,
    uniforms: { uC: { value: new THREE.Color(s.color) }, uT: { value: 0 }, uPh: { value: ph }, uOn: { value: 0 }, uFade: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), [s.color, ph]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock }, dt) => {
    mat.uniforms.uT.value = reduced ? 0.4 : clock.elapsedTime;
    mat.uniforms.uFade.value = Math.min(1, mat.uniforms.uFade.value + dt * 1.5);
    mat.uniforms.uOn.value = THREE.MathUtils.damp(mat.uniforms.uOn.value, on ? 1 : 0, 8, dt);
  });
  return <mesh geometry={haloGeo} material={mat} position={pos} quaternion={q} scale={size * (on ? 1.12 : 1)} raycast={() => null} renderOrder={3} />;
}

const ARC_FS = `uniform float uT; uniform float uFade; varying float vU; varying float vOff; varying vec3 vC;
void main(){ float h = fract(uT*.18 + vOff); float d = h - vU; float head = d >= 0. ? exp(-d*14.) : exp(-d*d*3000.);
  float a = (.18 * sin(3.14159*vU) + head * .7) * uFade; gl_FragColor = vec4(mix(vC, vec3(1.), head*.5), clamp(a, 0., .85)); }`;

/** Thin great-circle arcs between related countries, each with one light travelling along it. */
export function Arcs2({ pairs, R, reduced }: { pairs: { a: Spot; b: Spot; w: number }[]; R: number; reduced: boolean }) {
  const geo = useMemo(() => {
    const pos: number[] = [], u: number[] = [], off: number[] = [], col: number[] = [], idx: number[] = [];
    const SEG = 72, c = new THREE.Color(), c2 = new THREE.Color();
    pairs.forEach(({ a, b }, p) => {
      const va = toVec(a.lat, a.lon, 1), vb = toVec(b.lat, b.lon, 1), ang = va.angleTo(vb), base = pos.length / 3;
      c.set(a.color); c2.set(b.color);
      for (let s = 0; s <= SEG; s++) {
        const t = s / SEG, v = va.clone().lerp(vb, t).normalize().multiplyScalar(R * (1.004 + Math.sin(Math.PI * t) * (0.015 + ang * 0.035)));
        const m = c.clone().lerp(c2, t);
        pos.push(v.x, v.y, v.z); u.push(t); off.push(p * 0.29); col.push(m.r, m.g, m.b);
        if (s) idx.push(base + s - 1, base + s);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aU", new THREE.Float32BufferAttribute(u, 1));
    g.setAttribute("aOff", new THREE.Float32BufferAttribute(off, 1));
    g.setAttribute("aC", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  }, [pairs, R]);
  useEffect(() => () => geo.dispose(), [geo]);
  const mat = useMemo(() => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uT: { value: 0 }, uFade: { value: 0 } },
    vertexShader: "attribute float aU; attribute float aOff; attribute vec3 aC; varying float vU; varying float vOff; varying vec3 vC; void main(){ vU = aU; vOff = aOff; vC = aC; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
    fragmentShader: ARC_FS }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => { mat.uniforms.uFade.value = 0; }, [geo, mat]);
  useFrame(({ clock }, dt) => {
    mat.uniforms.uT.value = reduced ? 0.5 : clock.elapsedTime % 1000;
    mat.uniforms.uFade.value = Math.min(1, mat.uniforms.uFade.value + dt);
  });
  return <lineSegments geometry={geo} material={mat} raycast={() => null} renderOrder={4} />;
}
