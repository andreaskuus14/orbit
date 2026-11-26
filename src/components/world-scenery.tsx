"use client";
// v8 scenery shared by the planet worlds: a lit planet seen from orbit, gradient/nebula sky domes, lit window strips and
// a ring of instanced parts. All procedural (no files), shown only on tier 1+ by the scenes that use them.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

const vert = /* glsl */ `varying vec3 vW; varying vec3 vN; varying vec3 vO; void main(){ vO = position; vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; vN=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*viewMatrix*w; }`;
const noise = /* glsl */ `
  float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
  float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x), mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x), f.y),
               mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x), mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x), f.y), f.z); }
  float fbm3(vec3 p){ float s=0.0, a=0.5; for(int i=0;i<6;i++){ s+=a*n3(p); p*=2.02; a*=0.5; } return s; }`;

const earthFrag = /* glsl */ `uniform vec3 uSun; uniform float uT; varying vec3 vW; varying vec3 vN; varying vec3 vO; ${noise}
  void main(){
    vec3 p = normalize(vO);
    float land = smoothstep(0.52, 0.56, fbm3(p*2.6 + 1.7));
    float hi = fbm3(p*9.0);
    vec3 sea = mix(vec3(0.01,0.05,0.14), vec3(0.03,0.16,0.32), fbm3(p*5.0));
    vec3 ground = mix(vec3(0.10,0.22,0.08), vec3(0.42,0.34,0.20), smoothstep(0.4, 0.7, hi));
    ground = mix(ground, vec3(0.9), smoothstep(0.82, 0.9, abs(p.y)));
    float cl = smoothstep(0.5, 0.78, fbm3(p*4.0 + vec3(uT*0.004, 0.0, 0.0)));
    vec3 N = normalize(vN), L = normalize(uSun);
    float d = dot(N, L), day = smoothstep(-0.12, 0.25, d);
    vec3 col = mix(sea, ground, land) * (0.08 + 1.1*max(d, 0.0));
    col = mix(col, vec3(1.0)*(0.15 + 1.0*max(d,0.0)), cl*0.85);
    float city = land * (1.0-cl) * smoothstep(0.62, 0.8, fbm3(p*40.0)) * (1.0 - day);
    col += vec3(1.0,0.62,0.25) * city * 1.6;
    vec3 V = normalize(cameraPosition - vW);
    float spec = pow(max(dot(reflect(-L, N), V), 0.0), 40.0) * (1.0-land) * (1.0-cl);
    col += vec3(1.0,0.9,0.7) * spec * 0.8;
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);
    col += vec3(0.25,0.55,1.0) * rim * (0.25 + day);
    gl_FragColor = vec4(col, 1.0);
  }`;
const atmoFrag = /* glsl */ `uniform vec3 uSun; uniform vec3 uC; varying vec3 vW; varying vec3 vN; varying vec3 vO;
  void main(){ vec3 N = normalize(vN), V = normalize(cameraPosition - vW); float f = pow(1.0 - abs(dot(N, V)), 4.0);
    float day = smoothstep(-0.3, 0.4, dot(N, normalize(uSun))); gl_FragColor = vec4(uC * f * (0.2 + 1.6*day), f); }`;

/** A planet seen from orbit: oceans, land, clouds, night-side city lights, an atmosphere rim. */
export function OrbitalPlanet({ at, r, sun = [1, 0.4, 0.3], reduced, air = "#4f9dff" }: { at: [number, number, number]; r: number; sun?: [number, number, number]; reduced: boolean; air?: string }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: earthFrag, uniforms: { uSun: { value: new THREE.Vector3(...sun) }, uT: { value: 0 } } }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const atmo = useMemo(() => new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: atmoFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    uniforms: { uSun: { value: new THREE.Vector3(...sun) }, uC: { value: new THREE.Color(air) } } }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { mat.dispose(); atmo.dispose(); }, [mat, atmo]);
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (reduced) return; mat.uniforms.uT.value = clock.elapsedTime; if (g.current) g.current.rotation.y = clock.elapsedTime * 0.004; });
  return (<group position={at}>
    <group ref={g}><mesh material={mat}><sphereGeometry args={[r, 128, 64]} /></mesh></group>
    <mesh material={atmo} scale={1.04}><sphereGeometry args={[r, 64, 32]} /></mesh>
  </group>);
}

const skyFrag = /* glsl */ `uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uLow; uniform vec3 uNeb; uniform vec3 uNeb2; uniform float uStars; uniform float uNebK; varying vec3 vW; varying vec3 vN; varying vec3 vO; ${noise}
  void main(){
    vec3 d = normalize(vO); float y = d.y;
    vec3 c = mix(uLow, uMid, smoothstep(-0.1, 0.15, y)); c = mix(c, uTop, smoothstep(0.12, 0.7, y));
    float nb = fbm3(d*2.2 + 3.0), nb2 = fbm3(d*4.5 - 1.0);
    c += uNeb * smoothstep(0.45, 0.8, nb) * uNebK + uNeb2 * smoothstep(0.55, 0.85, nb2) * uNebK * 0.7;
    float s = step(0.9975, h3(floor(d*420.0))) * uStars * smoothstep(-0.05, 0.25, y);
    c += vec3(s);
    gl_FragColor = vec4(c, 1.0);
  }`;

/** A big inside-out sky sphere: three-stop gradient, optional nebula clouds and stars. */
export function SkyDome({ top, mid, low, neb = "#000000", neb2 = "#000000", nebK = 0, stars = 0, r = 90 }: { top: string; mid: string; low: string; neb?: string; neb2?: string; nebK?: number; stars?: number; r?: number }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color(top) }, uMid: { value: new THREE.Color(mid) }, uLow: { value: new THREE.Color(low) }, uNeb: { value: new THREE.Color(neb) }, uNeb2: { value: new THREE.Color(neb2) }, uNebK: { value: nebK }, uStars: { value: stars } } }),
    [top, mid, low, neb, neb2, nebK, stars]);
  useEffect(() => () => mat.dispose(), [mat]);
  return <mesh material={mat} renderOrder={-10}><sphereGeometry args={[r, 48, 24]} /></mesh>;
}

const h = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** Lit windows round a cylinder wall (radius r): rows of small glowing quads, some dark. One draw call. */
export function WindowRing({ r, y0, rows, n, size = [0.18, 0.1], color = "#ffd28a", k = 2.2, lit = 0.7, seed = 1, inward = false }: { r: number; y0: number; rows: number; n: number; size?: [number, number]; color?: string; k?: number; lit?: number; seed?: number; inward?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null), total = rows * n;
  useLayoutEffect(() => { const m = ref.current; if (!m) return; const o = new THREE.Object3D(), c = new THREE.Color(); let j = 0;
    for (let row = 0; row < rows; row++) for (let i = 0; i < n; i++) { const q = h(seed * 977 + row * 131 + i); if (q > lit) continue;
      const a = (i / n) * Math.PI * 2; o.position.set(Math.cos(a) * r, y0 + row * size[1] * 2.4, Math.sin(a) * r); o.rotation.set(0, -a + (inward ? -Math.PI / 2 : Math.PI / 2), 0); o.updateMatrix();
      m.setMatrixAt(j, o.matrix); m.setColorAt(j, c.set(color).multiplyScalar(k * (0.5 + q))); j++; }
    m.count = j; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); }, [r, y0, rows, n, color, k, lit, seed, inward, size]);
  return <instancedMesh ref={ref} args={[undefined, undefined, total]}><planeGeometry args={size} /><meshBasicMaterial toneMapped={false} side={THREE.DoubleSide} /></instancedMesh>;
}

/** Boxes laid round a circle (plating, pylons, shelves). One draw call. */
export function RingOf({ n, r, y, size, color, metal = 0.85, rough = 0.32, emissive = "#000", k = 0, skip, tiltOut = 0 }: { n: number; r: number; y: number; size: [number, number, number]; color: string; metal?: number; rough?: number; emissive?: string; k?: number; skip?: (i: number) => boolean; tiltOut?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => { const m = ref.current; if (!m) return; const o = new THREE.Object3D(); let j = 0;
    for (let i = 0; i < n; i++) { if (skip?.(i)) continue; const a = (i / n) * Math.PI * 2; o.position.set(Math.cos(a) * r, y, Math.sin(a) * r); o.rotation.set(0, -a, tiltOut); o.updateMatrix(); m.setMatrixAt(j++, o.matrix); }
    m.count = j; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }, [n, r, y, skip, tiltOut]);
  return <instancedMesh ref={ref} args={[undefined, undefined, n]}><boxGeometry args={size} /><meshStandardMaterial color={color} metalness={metal} roughness={rough} emissive={emissive} emissiveIntensity={k} /></instancedMesh>;
}
