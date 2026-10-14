"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import world from "world-atlas/countries-110m.json";
import { decodeCountries, unwrapRing, type CountryShape } from "@/lib/topo";
import type { Hotspot } from "@/lib/geo";

// INTELLIGENCE → World Pulse: a holographic Earth where countries in the news light up.
// The map is drawn from world-atlas country shapes onto a canvas texture (dot-matrix land, glowing borders),
// so hotspots line up with real geography. Data: /api/news/geo (articles tagged by country).

const R = 2;
const TEX_W = 4096, TEX_H = 2048;
const PICK_W = 2048, PICK_H = 1024;
const COUNTRIES: CountryShape[] = decodeCountries(world as never);
const safeHref = (u: string) => (/^https?:\/\//i.test(u) ? u : "#");
const ago = (iso: string | null) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** Lat/lon → point on the sphere, matching three.js SphereGeometry's equirectangular UVs. */
function toVec(lat: number, lon: number, r = R) {
  const phi = ((90 - lat) * Math.PI) / 180, theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

function tracePaths(g: CanvasRenderingContext2D, c: CountryShape, w: number, h: number) {
  g.beginPath();
  for (const raw of c.rings) {
    const ring = unwrapRing(raw);
    // Draw at -360/0/+360 so shapes crossing the date line wrap around the texture seam.
    for (const off of [-360, 0, 360]) {
      ring.forEach(([lon, lat], i) => {
        const x = ((lon + off + 180) / 360) * w, y = ((90 - lat) / 180) * h;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      });
      g.closePath();
    }
  }
}

/** Index map for clicks: each country filled with its own colour (index + 1). */
function buildPick() {
  const c = document.createElement("canvas");
  c.width = PICK_W; c.height = PICK_H;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.imageSmoothingEnabled = false;
  COUNTRIES.forEach((country, i) => {
    const n = i + 1;
    g.fillStyle = `rgb(${n & 255},${(n >> 8) & 255},0)`;
    tracePaths(g, country, PICK_W, PICK_H);
    g.fill("evenodd");
  });
  return g.getImageData(0, 0, PICK_W, PICK_H).data;
}

function buildTexture(heat: Map<string, number>, selected: string | null) {
  const c = document.createElement("canvas");
  c.width = TEX_W; c.height = TEX_H;
  const g = c.getContext("2d")!;
  // Ocean
  const ocean = g.createLinearGradient(0, 0, 0, TEX_H);
  ocean.addColorStop(0, "#03132b"); ocean.addColorStop(0.5, "#05214a"); ocean.addColorStop(1, "#03132b");
  g.fillStyle = ocean; g.fillRect(0, 0, TEX_W, TEX_H);
  // Graticule
  g.strokeStyle = "rgba(56,189,248,0.10)"; g.lineWidth = 2;
  for (let lon = -180; lon <= 180; lon += 15) { const x = ((lon + 180) / 360) * TEX_W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, TEX_H); g.stroke(); }
  for (let lat = -75; lat <= 75; lat += 15) { const y = ((90 - lat) / 180) * TEX_H; g.beginPath(); g.moveTo(0, y); g.lineTo(TEX_W, y); g.stroke(); }
  // Land mask → dot-matrix continents
  const m = document.createElement("canvas");
  m.width = 1024; m.height = 512;
  const mg = m.getContext("2d", { willReadFrequently: true })!;
  mg.fillStyle = "#fff";
  for (const country of COUNTRIES) { tracePaths(mg, country, 1024, 512); mg.fill("evenodd"); }
  const mask = mg.getImageData(0, 0, 1024, 512).data;
  const step = 9;
  g.fillStyle = "rgba(125,211,252,0.55)";
  for (let y = step / 2; y < TEX_H; y += step) {
    // Fewer dots toward the poles so they don't bunch up on the sphere.
    const lat = 90 - (y / TEX_H) * 180, sx = step / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
    for (let x = (y / step) % 2 ? sx / 2 : 0; x < TEX_W; x += sx) {
      const mi = (Math.floor((y / TEX_H) * 512) * 1024 + Math.floor((x / TEX_W) * 1024)) * 4;
      if (mask[mi] > 128) g.fillRect(x - 1.6, y - 1.6, 3.2, 3.2);
    }
  }
  // Countries in the news: warm fills, brighter with more stories; the selected one turns cyan.
  const max = Math.max(1, ...heat.values());
  for (const country of COUNTRIES) {
    const n = heat.get(country.name) ?? 0;
    const sel = country.name === selected;
    tracePaths(g, country, TEX_W, TEX_H);
    if (sel) { g.fillStyle = "rgba(34,211,238,0.55)"; g.fill("evenodd"); }
    else if (n) { const k = 0.35 + 0.65 * Math.sqrt(n / max); g.fillStyle = `rgba(251,146,60,${0.18 + 0.42 * k})`; g.fill("evenodd"); }
    g.strokeStyle = sel ? "rgba(165,243,252,1)" : n ? "rgba(253,186,116,0.9)" : "rgba(56,189,248,0.35)";
    g.lineWidth = sel ? 5 : n ? 3 : 1.6;
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const atmosphere = new THREE.ShaderMaterial({
  transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
  vertexShader: "varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: "varying vec3 vN; void main(){ float i = pow(0.72 - dot(vN, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(0.13,0.75,0.95,1.0) * i * 0.75; }",
});
const rim = new THREE.ShaderMaterial({
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  vertexShader: "varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: "varying vec3 vN; void main(){ float i = pow(1.0 - abs(dot(vN, vec3(0.0,0.0,1.0))), 2.5); gl_FragColor = vec4(0.2,0.8,1.0,1.0) * i * 0.7; }",
});

const glowTex = (() => {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,255,255,0.8)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

function Marker({ h, max, selected, reduced, onPick }: { h: Hotspot; max: number; selected: boolean; reduced: boolean; onPick: (n: string) => void }) {
  const pos = useMemo(() => toVec(h.lat, h.lon, R * 1.004), [h.lat, h.lon]);
  const k = Math.sqrt(h.count / max);
  const ring = useRef<THREE.Mesh>(null);
  const beam = useMemo(() => {
    const len = 0.12 + 0.55 * k;
    const up = pos.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up); // beam along the surface normal
    const flat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), up); // ring lying on the surface
    return { len, q, flat, mid: up.clone().multiplyScalar(R + len / 2) };
  }, [pos, k]);
  const color = selected ? "#a5f3fc" : "#fdba74";
  const phase = useMemo(() => Math.random() * 2, []);
  useFrame(({ clock }) => {
    if (!ring.current) return;
    const t = reduced ? 0.5 : ((clock.elapsedTime * 0.6 + phase) % 1);
    const s = 0.08 + (0.22 + 0.25 * k) * t;
    ring.current.scale.setScalar(s);
    (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
  });
  return (
    <group>
      <mesh position={beam.mid} quaternion={beam.q} onClick={(e) => { e.stopPropagation(); onPick(h.name); }}>
        <cylinderGeometry args={[0.012 + 0.012 * k, 0.004, beam.len, 8, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <sprite position={pos.clone().normalize().multiplyScalar(R + beam.len)} scale={0.06 + 0.08 * k} onClick={(e) => { e.stopPropagation(); onPick(h.name); }}>
        <spriteMaterial map={glowTex} color={color} transparent blending={THREE.AdditiveBlending} depthWrite={false} />
      </sprite>
      <mesh ref={ring} position={pos} quaternion={beam.flat}>
        <ringGeometry args={[0.85, 1, 48]} />
        <meshBasicMaterial color={color} transparent side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** Intro fly-in, then eases the camera to face the selected country. */
function Rig({ focus, reduced, offsetX }: { focus: Hotspot | null; reduced: boolean; offsetX: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as { autoRotate: boolean; update: () => void; addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void } | null;
  const flight = useRef<{ from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (size.width >= 900) camera.setViewOffset(size.width, size.height, offsetX, 0, size.width, size.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }, [camera, size, offsetX]);

  useEffect(() => {
    if (!started.current) { // fly in from far away
      started.current = true;
      const to = camera.position.clone().normalize().multiplyScalar(7.6);
      camera.position.multiplyScalar(2.6);
      flight.current = { from: camera.position.clone(), to, t: reduced ? 1 : 0, dur: 1.8 };
    }
  }, [camera, reduced]);

  useEffect(() => {
    if (controls) controls.autoRotate = !focus && !reduced;
    if (!focus) return;
    const dist = Math.max(4.8, Math.min(7.6, camera.position.length()));
    flight.current = { from: camera.position.clone(), to: toVec(focus.lat, focus.lon, dist), t: reduced ? 1 : 0, dur: 1.4 };
  }, [focus, controls, camera, reduced]);

  useEffect(() => {
    if (!controls) return;
    const stop = () => { flight.current = null; };
    controls.addEventListener("start", stop); // the user grabbed the globe: hand control back
    return () => controls.removeEventListener("start", stop);
  }, [controls]);

  useFrame((_, dt) => {
    const f = flight.current;
    if (f) {
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      // Slerp the direction and lerp the distance, so the camera swings around the globe instead of cutting through it.
      const dir = f.from.clone().normalize().lerp(f.to.clone().normalize(), e).normalize();
      const dist = THREE.MathUtils.lerp(f.from.length(), f.to.length(), e);
      camera.position.copy(dir.multiplyScalar(dist));
      camera.lookAt(0, 0, 0);
      if (f.t >= 1) flight.current = null;
    }
    controls?.update();
  });
  return null;
}

function Globe({ hotspots, selected, onPick, reduced }: { hotspots: Hotspot[]; selected: string | null; onPick: (n: string | null) => void; reduced: boolean }) {
  const heat = useMemo(() => new Map(hotspots.map((h) => [h.name, h.count])), [hotspots]);
  const texture = useMemo(() => buildTexture(heat, selected), [heat, selected]);
  useEffect(() => () => texture.dispose(), [texture]);
  const pick = useMemo(() => buildPick(), []);
  const max = Math.max(1, ...hotspots.map((h) => h.count));
  const down = useRef<{ x: number; y: number } | null>(null);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    // Ignore the click that ends a drag.
    if (down.current && Math.hypot(e.nativeEvent.clientX - down.current.x, e.nativeEvent.clientY - down.current.y) > 5) return;
    const uv = e.uv;
    if (!uv) return;
    const x = Math.min(PICK_W - 1, Math.floor(uv.x * PICK_W)), y = Math.min(PICK_H - 1, Math.floor((1 - uv.y) * PICK_H));
    const i = (y * PICK_W + x) * 4, n = pick[i] + (pick[i + 1] << 8);
    onPick(n ? COUNTRIES[n - 1].name : null);
  };

  return (
    <group>
      <mesh onPointerDown={(e) => { down.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY }; }} onClick={onClick}>
        <sphereGeometry args={[R, 96, 96]} />
        <meshBasicMaterial map={texture} />
      </mesh>
      <mesh material={rim}><sphereGeometry args={[R * 1.002, 64, 64]} /></mesh>
      <mesh material={atmosphere} scale={1.12}><sphereGeometry args={[R, 64, 64]} /></mesh>
      {hotspots.map((h) => <Marker key={h.name} h={h} max={max} selected={h.name === selected} reduced={reduced} onPick={onPick} />)}
    </group>
  );
}

/** Projects the top hotspot names onto the screen as HTML labels; hides those on the far side. */
function Labels({ hotspots, refs }: { hotspots: Hotspot[]; refs: React.RefObject<Record<string, HTMLSpanElement | null>> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  const n = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const h of hotspots) {
      const el = refs.current?.[h.name];
      if (!el) continue;
      v.copy(toVec(h.lat, h.lon, R * 1.02));
      const facing = n.copy(v).normalize().dot(camera.position.clone().normalize()) > 0.25;
      v.project(camera);
      el.style.opacity = facing ? "1" : "0";
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width + 10}px, ${((1 - v.y) / 2) * size.height - 8}px)`;
    }
  });
  return null;
}

type Data = { hours: number; total: number; untagged: number; hotspots: Hotspot[] };

export default function NewsGlobe({ onClose, reduced }: { onClose: () => void; reduced: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const labels = useRef<Record<string, HTMLSpanElement | null>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/news/geo?hours=72", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Couldn't load news (${res.status})`);
      setData(json); setErr("");
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load news"); }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 5 * 60_000);
    addEventListener("orbit:news", load); // a new briefing just finished
    return () => { clearInterval(t); removeEventListener("orbit:news", load); };
  }, [load]);

  const hs = data?.hotspots ?? [];
  const focus = hs.find((h) => h.name === selected) ?? null;
  const top = hs.slice(0, 8);
  const picked = selected && !focus ? selected : null; // a country with no stories

  return (
    <div className="absolute inset-0 globe-in" aria-label="World news globe">
      <Canvas camera={{ position: [3.2, 1.6, 5.2], fov: 45 }} dpr={[1, 1.75]} gl={{ antialias: true }}>
        <color attach="background" args={["#02040b"]} />
        <Stars radius={60} depth={30} count={reduced ? 1200 : 3500} factor={2.6} fade speed={reduced ? 0 : 0.4} />
        <Globe hotspots={hs} selected={selected} onPick={setSelected} reduced={reduced} />
        <OrbitControls makeDefault enablePan={false} minDistance={3.1} maxDistance={12} enableDamping rotateSpeed={0.5} autoRotateSpeed={0.35} />
        <Rig focus={focus} reduced={reduced} offsetX={110} />
        <Labels hotspots={top} refs={labels} />
      </Canvas>

      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {top.map((h) => (
          <span key={h.name} ref={(el) => { labels.current[h.name] = el; }} className="globe-label absolute left-0 top-0">
            {h.name === "United States of America" ? "USA" : h.name} <b>{h.count}</b>
          </span>
        ))}
      </div>

      <section className="glass hud-panel absolute left-3 top-[4.5rem] w-72 max-h-[calc(100dvh-11rem)] overflow-y-auto p-3 max-[1100px]:hidden">
        <div className="hud-title">WORLD PULSE</div>
        <p className="muted text-xs">{data ? `Last ${data.hours} h · ${data.total} stories · ${hs.length} countries` : err ? "" : "Loading…"}</p>
        {err && <p className="error mt-2">{err}</p>}
        {data && !hs.length && <p className="mt-3 text-sm">No placed stories yet. Run a <b>World brief</b> in the panel on the right and the globe lights up.</p>}
        <ol className="mt-3 space-y-1">
          {hs.slice(0, 14).map((h) => (
            <li key={h.name}>
              <button className={`hud-row${h.name === selected ? " on" : ""}`} onClick={() => setSelected(h.name === selected ? null : h.name)}>
                <span className="truncate">{h.name}</span>
                <span className="hud-bar"><i style={{ width: `${(h.count / (hs[0]?.count || 1)) * 100}%` }} /></span>
                <span className="num">{h.count}</span>
              </button>
            </li>
          ))}
        </ol>
        {data && data.untagged > 0 && <p className="muted mt-2 text-xs">{data.untagged} stories don&apos;t name a country.</p>}
      </section>

      {(focus || picked) && (
        <section className="glass hud-panel absolute bottom-24 left-3 w-[min(24rem,calc(100vw-1.5rem))] max-h-[45dvh] overflow-y-auto p-3 min-[1101px]:left-[19.5rem]" aria-live="polite">
          <div className="flex items-start justify-between gap-2">
            <div><div className="hud-title">{(focus?.name ?? picked)!.toUpperCase()}</div>
              <p className="muted text-xs">{focus ? `${focus.count} stor${focus.count === 1 ? "y" : "ies"} in the last ${data?.hours ?? 72} h` : "No stories about this country right now."}</p></div>
            <button className="chip" onClick={() => setSelected(null)}>Close</button>
          </div>
          <ul className="mt-2 space-y-2">
            {focus?.stories.map((s) => (
              <li key={s.url} className="card text-sm">
                <a className="link" href={safeHref(s.url)} target="_blank" rel="noreferrer noopener">{s.title}</a>
                <div className="muted text-xs">{s.source ?? "unknown source"}{s.published_at ? ` · ${ago(s.published_at)}` : ""}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button className="chip absolute bottom-24 right-3 min-[900px]:right-[32rem]" onClick={onClose}>← Back to galaxy</button>
    </div>
  );
}
