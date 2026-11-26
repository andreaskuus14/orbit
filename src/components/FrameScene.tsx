"use client";
// v10 frame-based 2.5D world: the owner's Higgsfield render is the scene. A full-screen quad samples the frame with a
// Depth Anything V2 depth map for mouse/scroll parallax, dollies into the picked place and crossfades to the zoom frame,
// with a little life (emissive-mask pulse, flicker, drifting motes). Live glass labels sit on the frame's places and are
// bound to the planet's real chips; a click fires onPick (PlanetWorld turns it into orbit:world-pick). Pure maths in
// frame-scene-pure.ts. The procedural world stays the low tier and the fallback (tier 0, flat, or a failed texture load).
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Chip } from "./world-kit";
import { GLOW, SPOTS, bindSpots, coverScale, dolly, focusFor, frameUrl, onScreen, spotScreen, ZOOM_FRAMES, type FrameId, type Vec2 } from "@/lib/frame-scene-pure";

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uC, uD, uZC, uZD;
uniform vec2 uCover, uMouse, uFocus; uniform float uZoom, uFade, uTime, uK, uLife, uHasZoom, uLo, uHi, uPulse, uFlick, uSpeed;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 sampleFrame(sampler2D c, sampler2D dm, vec2 p){
  float d = texture2D(dm, vec2(p.x, 1.0 - p.y)).r;
  vec2 s = clamp(p + uMouse * (d - 0.5) * uK * 2.0, 0.002, 0.998);
  vec3 col = texture2D(c, vec2(s.x, 1.0 - s.y)).rgb;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  float m = smoothstep(uLo, uHi, l);
  float wave = sin(uTime * uSpeed + p.x * 9.0 + p.y * 7.0 + h21(floor(p * 28.0)) * 6.283);
  float fl = h21(floor(p * 60.0) + floor(uTime * 9.0)) - 0.5;
  return col * (1.0 + uLife * m * (uPulse * wave + uFlick * fl));
}
void main(){
  vec2 q = vec2(vUv.x, 1.0 - vUv.y);
  vec2 f = (q - 0.5) * uCover + 0.5;
  vec2 p = uFocus + (f - uFocus) / uZoom;
  vec3 a = sampleFrame(uC, uD, p);
  vec3 col = a;
  if (uHasZoom > 0.5 && uFade > 0.001) col = mix(a, sampleFrame(uZC, uZD, f), uFade);
  float v = smoothstep(1.1, 0.35, length(q - 0.5));
  col *= mix(0.72, 1.0, v);
  gl_FragColor = vec4(col, 1.0);
}`;
const PVERT = `attribute vec3 seed; uniform float uTime, uLife; uniform vec2 uCover; varying float vA;
void main(){ float t = uTime * (0.02 + seed.z * 0.03) * uLife;
  vec2 p = vec2(fract(seed.x + t * 0.6 + sin(t * 4.0 + seed.y * 6.0) * 0.02), fract(seed.y - t));
  vA = (0.25 + 0.75 * seed.z) * smoothstep(0.0, 0.15, p.y) * smoothstep(1.0, 0.85, p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); gl_PointSize = 1.5 + seed.z * 2.5; }`;
const PFRAG = `precision mediump float; uniform vec3 uColor; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(uColor, vA * smoothstep(0.5, 0.1, r) * 0.55); }`;

type Rt = { mouse: Vec2; mt: Vec2; t: number; tt: number; focus: Vec2; ft: Vec2; fade: number };

function Quad({ id, rt, labels, reduced, hasZoom, tex, color, cover }: {
  id: FrameId; rt: React.MutableRefObject<Rt>; labels: React.MutableRefObject<Map<string, { el: HTMLDivElement; x: number; y: number; d: number }>>;
  reduced: boolean; hasZoom: boolean; tex: THREE.Texture[]; color: string; cover: React.MutableRefObject<Vec2>;
}) {
  const mat = useRef<THREE.ShaderMaterial>(null), pmat = useRef<THREE.ShaderMaterial>(null);
  const uni = useMemo(() => ({
    uC: { value: tex[0] }, uD: { value: tex[1] }, uZC: { value: tex[2] ?? tex[0] }, uZD: { value: tex[3] ?? tex[1] },
    uCover: { value: new THREE.Vector2(1, 1) }, uMouse: { value: new THREE.Vector2() }, uFocus: { value: new THREE.Vector2(0.5, 0.5) },
    uZoom: { value: 1 }, uFade: { value: 0 }, uTime: { value: 0 }, uK: { value: 0.022 }, uLife: { value: reduced ? 0 : 1 }, uHasZoom: { value: hasZoom ? 1 : 0 },
    uLo: { value: GLOW.lo }, uHi: { value: GLOW.hi }, uPulse: { value: GLOW.pulse }, uFlick: { value: GLOW.flicker }, uSpeed: { value: GLOW.speed },
  }), [tex, reduced, hasZoom]);
  const pg = useMemo(() => {
    const g = new THREE.BufferGeometry(), n = 90, a = new Float32Array(n * 3), pos = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) a[i] = Math.random();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("seed", new THREE.BufferAttribute(a, 3)); return g;
  }, []);
  const pu = useMemo(() => ({ uTime: { value: 0 }, uLife: { value: reduced ? 0 : 1 }, uCover: { value: new THREE.Vector2(1, 1) }, uColor: { value: new THREE.Color(color) } }), [reduced, color]);
  useFrame(({ clock, size }, dt) => {
    const r = rt.current, k = 1 - Math.exp(-dt * 4), time = clock.elapsedTime;
    r.mouse = [r.mouse[0] + (r.mt[0] - r.mouse[0]) * k, r.mouse[1] + (r.mt[1] - r.mouse[1]) * k];
    r.t += (r.tt - r.t) * (1 - Math.exp(-dt * 2.6));
    r.focus = [r.focus[0] + (r.ft[0] - r.focus[0]) * k, r.focus[1] + (r.ft[1] - r.focus[1]) * k];
    const dl = dolly(r.t), cv = coverScale(2048 / 1146, size.width / size.height); cover.current = cv;
    r.fade = hasZoom ? dl.fade : 0;
    const u = mat.current?.uniforms; if (!u) return;
    (u.uCover.value as THREE.Vector2).set(cv[0], cv[1]); (u.uMouse.value as THREE.Vector2).set(r.mouse[0], r.mouse[1]); (u.uFocus.value as THREE.Vector2).set(r.focus[0], r.focus[1]);
    u.uZoom.value = dl.z; u.uFade.value = r.fade; u.uTime.value = time;
    if (pmat.current) pmat.current.uniforms.uTime.value = time;
    for (const l of labels.current.values()) {
      const p = spotScreen({ x: l.x, y: l.y, d: l.d }, { mouse: r.mouse, z: dl.z, focus: r.focus, cover: cv });
      const vis = onScreen(p) && r.fade < 0.6;
      l.el.style.opacity = vis ? "1" : "0"; l.el.style.pointerEvents = vis ? "auto" : "none";
      if (vis) l.el.style.transform = `translate3d(${p[0] * size.width}px, ${p[1] * size.height}px, 0) translate(-50%, -50%)`;
    }
  });
  return <>
    <mesh frustumCulled={false}><planeGeometry args={[2, 2]} /><shaderMaterial ref={mat} vertexShader={VERT} fragmentShader={FRAG} uniforms={uni} depthTest={false} depthWrite={false} /></mesh>
    {!reduced && <points frustumCulled={false} geometry={pg}><shaderMaterial ref={pmat} vertexShader={PVERT} fragmentShader={PFRAG} uniforms={pu} transparent depthTest={false} depthWrite={false} blending={THREE.AdditiveBlending} /></points>}
  </>;
}

export default function FrameScene({ id, chips, onPick, reduced, paused, glow, onBack, back }: {
  id: FrameId; chips: Chip[]; onPick: (id: string) => void; reduced: boolean; paused?: boolean; glow: string; onBack?: () => void; back: string;
}) {
  const [tex, setTex] = useState<THREE.Texture[] | null>(null);
  const [failed, setFailed] = useState(false);
  const hasZoom = ZOOM_FRAMES.includes(id);
  const rt = useRef<Rt>({ mouse: [0, 0], mt: [0, 0], t: 0, tt: 0, focus: [0.5, 0.5], ft: [0.5, 0.5], fade: 0 });
  const cover = useRef<Vec2>([1, 1]);
  const labels = useRef(new Map<string, { el: HTMLDivElement; x: number; y: number; d: number }>());
  const root = useRef<HTMLDivElement>(null);
  const bound = useMemo(() => bindSpots(id, chips), [id, chips]);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    let live = true; const loader = new THREE.TextureLoader(); const urls = [frameUrl(id), frameUrl(id, "depth"), ...(hasZoom ? [frameUrl(id, "zoom"), frameUrl(id, "zoom-depth")] : [])];
    Promise.all(urls.map((u) => loader.loadAsync(u).catch(() => null))).then((t) => {
      if (!live) return;
      if (!t[0] || !t[1]) { setFailed(true); return; }
      const ok = t.slice(0, hasZoom && t[2] && t[3] ? 4 : 2) as THREE.Texture[];
      for (const x of ok) { x.colorSpace = x === ok[1] || x === ok[3] ? THREE.NoColorSpace : THREE.SRGBColorSpace; x.minFilter = THREE.LinearFilter; x.generateMipmaps = false; }
      setTex(ok);
    });
    return () => { live = false; };
  }, [id, hasZoom]);

  useEffect(() => {
    const el = root.current; if (!el) return;
    const move = (e: PointerEvent) => { const b = el.getBoundingClientRect(); rt.current.mt = [((e.clientX - b.left) / b.width - 0.5) * 2, ((e.clientY - b.top) / b.height - 0.5) * 2]; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); const r = rt.current, b = el.getBoundingClientRect();
      if (r.tt < 0.02 && e.deltaY < 0) { const c = cover.current; r.ft = focusFor({ x: ((e.clientX - b.left) / b.width - 0.5) * c[0] + 0.5, y: ((e.clientY - b.top) / b.height - 0.5) * c[1] + 0.5 }); }
      r.tt = Math.max(0, Math.min(1, r.tt - e.deltaY * 0.0012)); setZoomed(r.tt > 0.05);
    };
    el.addEventListener("pointermove", move); el.addEventListener("wheel", wheel, { passive: false });
    return () => { el.removeEventListener("pointermove", move); el.removeEventListener("wheel", wheel); };
  }, [tex]);

  const pickIt = (cid: string, s: { x: number; y: number }) => {
    rt.current.ft = focusFor({ x: s.x, y: s.y }); rt.current.tt = 1; setZoomed(true); onPick(cid);
  };
  const out = () => { rt.current.tt = 0; rt.current.ft = [0.5, 0.5]; setZoomed(false); onBack?.(); };

  if (failed) return null;
  return (
    <div ref={root} className="absolute inset-0" data-frame-scene={id} data-zoomed={zoomed ? "1" : "0"}>
      {tex && (
        <Canvas orthographic frameloop={paused ? "never" : "always"} dpr={[1, 1.5]} gl={{ antialias: false, powerPreference: "high-performance" }} camera={{ position: [0, 0, 1] }}>
          <Quad id={id} rt={rt} labels={labels} reduced={reduced} hasZoom={tex.length === 4} tex={tex} color={glow} cover={cover} />
        </Canvas>
      )}
      <div className="wchip-layer">
        {bound.map(({ spot, chip }) => (
          <div key={chip.id} ref={(el) => { if (el) labels.current.set(chip.id, { el, x: spot.x, y: spot.y, d: spot.d ?? 0.6 }); else labels.current.delete(chip.id); }}
            className="wchip" data-id={chip.id} role="button" tabIndex={0} style={{ ["--c" as string]: chip.color }}
            onClick={() => pickIt(chip.id, spot)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") pickIt(chip.id, spot); }}>
            <span className="wchip-t">{chip.dot && <i className={`wchip-dot ${chip.dot}`} />}{chip.title}</span>
            {chip.value && <b className="wchip-v">{chip.value}</b>}
            {chip.sub && <span className="wchip-s">{chip.sub}</span>}
          </div>
        ))}
      </div>
      {zoomed && <button className="chip absolute left-3 top-[4.5rem] z-[15]" onClick={out}>{back}</button>}
    </div>
  );
}
export { SPOTS };
