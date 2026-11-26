"use client";
// ARCH preview materials: small procedural textures drawn once on a canvas (no downloads, no licence questions: they're ours).
// Each is a colour map plus a bump map, tiled in metres (arch-mesh-pure gives every face world-space UVs in metres).
import * as THREE from "three";
import type { MatKey } from "@/lib/arch-mesh-pure";

type Draw = (c: CanvasRenderingContext2D, n: number, rnd: () => number) => void;
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

/** Speckle noise over what is drawn: k = strength (0-255 range). */
function speckle(c: CanvasRenderingContext2D, n: number, rnd: () => number, k: number) {
  const img = c.getImageData(0, 0, n, n), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const v = (rnd() - 0.5) * k; d[i] += v; d[i + 1] += v; d[i + 2] += v; }
  c.putImageData(img, 0, 0);
}
/** Soft blotches (a few big low-alpha circles): weathering, so a wall isn't one flat colour. */
function blotch(c: CanvasRenderingContext2D, n: number, rnd: () => number, col: string, count: number, a: number) {
  for (let i = 0; i < count; i++) { c.globalAlpha = a * rnd(); c.fillStyle = col; c.beginPath(); c.arc(rnd() * n, rnd() * n, (0.05 + rnd() * 0.2) * n, 0, 7); c.fill(); }
  c.globalAlpha = 1;
}

/** Each texture: metres covered by one tile, a colour drawer, a bump drawer (white = proud). */
const TEX: Partial<Record<MatKey | "lawn" | "gravel" | "paving" | "glow", { m: number; size?: number; color: Draw; bump?: Draw }>> = {
  plaster: { m: 2, color: (c, n, r) => { c.fillStyle = "#e4ddd0"; c.fillRect(0, 0, n, n); blotch(c, n, r, "#d9d2c4", 14, 0.25); speckle(c, n, r, 14); },
    bump: (c, n, r) => { c.fillStyle = "#808080"; c.fillRect(0, 0, n, n); speckle(c, n, r, 70); } },
  timber: { m: 1.2, color: (c, n, r) => { // vertical boards 120 mm, battens between: the classic Nordic board-on-board look
    const boards = 10, bw = n / boards;
    for (let i = 0; i < boards; i++) { const t = 0.85 + r() * 0.2; c.fillStyle = `rgb(${Math.round(132 * t)},${Math.round(112 * t)},${Math.round(90 * t)})`; c.fillRect(i * bw, 0, bw, n);
      c.strokeStyle = "rgba(60,45,30,0.25)"; for (let k = 0; k < 5; k++) { const x = i * bw + r() * bw; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + (r() - 0.5) * 4, n); c.stroke(); } }
    c.fillStyle = "rgba(40,30,22,0.55)"; for (let i = 0; i <= boards; i++) c.fillRect(i * bw - 1.5, 0, 3, n);
    speckle(c, n, r, 10); },
    bump: (c, n) => { const bw = n / 10; c.fillStyle = "#b0b0b0"; c.fillRect(0, 0, n, n); c.fillStyle = "#202020"; for (let i = 0; i <= 10; i++) c.fillRect(i * bw - 2, 0, 4, n); } },
  trim: { m: 1, color: (c, n, r) => { c.fillStyle = "#e9e5dc"; c.fillRect(0, 0, n, n); speckle(c, n, r, 8); } },
  brick: { m: 1, color: (c, n, r) => { // 250 × 65 mm bricks, 10 mm joints, running bond
    c.fillStyle = "#b9b1a6"; c.fillRect(0, 0, n, n);
    const bh = n / 13.33, bw = n / 3.85;
    for (let row = 0; row < 14; row++) for (let i = -1; i < 5; i++) { const t = 0.8 + r() * 0.3; c.fillStyle = `rgb(${Math.round(150 * t)},${Math.round(72 * t)},${Math.round(52 * t)})`; c.fillRect(i * bw + (row % 2) * bw / 2 + 1.5, row * bh + 1.5, bw - 3, bh - 3); }
    speckle(c, n, r, 16); },
    bump: (c, n) => { c.fillStyle = "#202020"; c.fillRect(0, 0, n, n); const bh = n / 13.33, bw = n / 3.85; c.fillStyle = "#c0c0c0"; for (let row = 0; row < 14; row++) for (let i = -1; i < 5; i++) c.fillRect(i * bw + (row % 2) * bw / 2 + 2, row * bh + 2, bw - 4, bh - 4); } },
  concrete: { m: 2.4, color: (c, n, r) => { c.fillStyle = "#a7a49e"; c.fillRect(0, 0, n, n); blotch(c, n, r, "#8f8c86", 18, 0.3); c.fillStyle = "rgba(70,70,70,0.25)"; c.fillRect(0, n / 2, n, 2); speckle(c, n, r, 22); },
    bump: (c, n, r) => { c.fillStyle = "#808080"; c.fillRect(0, 0, n, n); speckle(c, n, r, 50); } },
  roofMetal: { m: 1, color: (c, n, r) => { c.fillStyle = "#3b3e42"; c.fillRect(0, 0, n, n); c.fillStyle = "#505459"; for (let i = 0; i < 2; i++) c.fillRect(i * n / 2, 0, 5, n); speckle(c, n, r, 5); },
    bump: (c, n) => { c.fillStyle = "#606060"; c.fillRect(0, 0, n, n); c.fillStyle = "#ffffff"; for (let i = 0; i < 2; i++) c.fillRect(i * n / 2, 0, 5, n); } }, // seams every 0.5 m
  roofTile: { m: 1, color: (c, n, r) => { c.fillStyle = "#2a2a2c"; c.fillRect(0, 0, n, n);
    for (let row = 0; row < 3; row++) for (let i = 0; i < 4; i++) { const t = 0.8 + r() * 0.3; c.fillStyle = `rgb(${Math.round(112 * t)},${Math.round(58 * t)},${Math.round(44 * t)})`; c.fillRect(i * n / 4 + 1, row * n / 3 + 1, n / 4 - 2, n / 3 - 6); }
    speckle(c, n, r, 10); },
    bump: (c, n) => { const g = c.createLinearGradient(0, 0, 0, n / 3); g.addColorStop(0, "#303030"); g.addColorStop(1, "#d0d0d0"); c.fillStyle = g; for (let row = 0; row < 3; row++) { c.save(); c.translate(0, row * n / 3); c.fillRect(0, 0, n, n / 3); c.restore(); } } },
  roofMembrane: { m: 3, color: (c, n, r) => { c.fillStyle = "#45474a"; c.fillRect(0, 0, n, n); speckle(c, n, r, 14); } },
  plinth: { m: 2, color: (c, n, r) => { c.fillStyle = "#b4b1ab"; c.fillRect(0, 0, n, n); blotch(c, n, r, "#76736d", 10, 0.3); speckle(c, n, r, 20); } },
  floor: { m: 2, color: (c, n, r) => { const k = 12; for (let i = 0; i < k; i++) { const t = 0.85 + r() * 0.25; c.fillStyle = `rgb(${Math.round(176 * t)},${Math.round(140 * t)},${Math.round(98 * t)})`; c.fillRect(0, i * n / k, n, n / k); } c.fillStyle = "rgba(60,40,20,0.3)"; for (let i = 0; i < k; i++) c.fillRect(0, i * n / k, n, 1); speckle(c, n, r, 8); } },
  deck: { m: 1.4, color: (c, n, r) => { const k = 10; for (let i = 0; i < k; i++) { const t = 0.8 + r() * 0.3; c.fillStyle = `rgb(${Math.round(128 * t)},${Math.round(106 * t)},${Math.round(84 * t)})`; c.fillRect(0, i * n / k, n, n / k - 3); } speckle(c, n, r, 10); } },
  lawn: { m: 6, size: 512, color: (c, n, r) => { c.fillStyle = "#6d8a46"; c.fillRect(0, 0, n, n); blotch(c, n, r, "#58733a", 40, 0.35); blotch(c, n, r, "#8aa35a", 30, 0.25);
    for (let i = 0; i < 5000; i++) { c.fillStyle = r() < 0.5 ? "rgba(48,70,28,0.5)" : "rgba(150,170,90,0.4)"; c.fillRect(r() * n, r() * n, 1, 2 + r() * 2); } } },
  gravel: { m: 1.5, color: (c, n, r) => { c.fillStyle = "#9b958b"; c.fillRect(0, 0, n, n); for (let i = 0; i < 2600; i++) { const t = 0.6 + r() * 0.6; c.fillStyle = `rgb(${Math.round(170 * t)},${Math.round(164 * t)},${Math.round(154 * t)})`; c.beginPath(); c.arc(r() * n, r() * n, 0.8 + r() * 2.2, 0, 7); c.fill(); } },
    bump: (c, n, r) => { c.fillStyle = "#404040"; c.fillRect(0, 0, n, n); for (let i = 0; i < 2600; i++) { c.fillStyle = "#c0c0c0"; c.beginPath(); c.arc(r() * n, r() * n, 0.8 + r() * 2.2, 0, 7); c.fill(); } } },
  // lit window: a warm interior seen through the glass, bright up by the ceiling light, dim at the floor, a few darker shapes (furniture, a curtain edge). One tile = one 3 m storey.
  glow: { m: 3, size: 128, color: (c, n, r) => { const g = c.createLinearGradient(0, 0, 0, n); g.addColorStop(0, "#fff0d0"); g.addColorStop(0.35, "#ffc77a"); g.addColorStop(1, "#6a3f1c"); c.fillStyle = g; c.fillRect(0, 0, n, n);
    c.fillStyle = "rgba(40,20,8,0.35)"; for (let i = 0; i < 5; i++) c.fillRect(r() * n, n * (0.55 + r() * 0.4), n * (0.1 + r() * 0.2), n * 0.5); } },
  paving: { m: 1.2, color: (c, n, r) => { c.fillStyle = "#6f6c67"; c.fillRect(0, 0, n, n); for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { const t = 0.85 + r() * 0.2; c.fillStyle = `rgb(${Math.round(176 * t)},${Math.round(172 * t)},${Math.round(165 * t)})`; c.fillRect(a * n / 2 + 2, b * n / 2 + 2, n / 2 - 4, n / 2 - 4); } speckle(c, n, r, 14); } },
};

function canvasTex(key: string, draw: Draw, size: number, m: number, color: boolean): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas"); cv.width = cv.height = size;
  const c = cv.getContext("2d", { willReadFrequently: true }); if (!c) return null;
  let h = 7; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  draw(c, size, rng(h + (color ? 0 : 1)));
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / m, 1 / m); t.anisotropy = 4;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

type Spec = { color?: string; rough: number; metal?: number; tex?: keyof typeof TEX; bump?: number };
const SPEC: Record<MatKey, Spec> = {
  plaster: { rough: 0.92, tex: "plaster", bump: 0.6 }, timber: { rough: 0.8, tex: "timber", bump: 1.2 }, brick: { rough: 0.9, tex: "brick", bump: 1 }, concrete: { rough: 0.85, tex: "concrete", bump: 0.5 },
  inner: { color: "#f2efe9", rough: 0.9 }, plinth: { rough: 0.9, tex: "plinth" }, floor: { rough: 0.6, tex: "floor" }, deck: { rough: 0.8, tex: "deck" },
  roofMetal: { rough: 0.34, metal: 0.6, tex: "roofMetal", bump: 1.5 }, roofTile: { rough: 0.75, tex: "roofTile", bump: 1.5 }, roofMembrane: { rough: 0.9, tex: "roofMembrane" },
  fascia: { color: "#2f3236", rough: 0.6 }, gutter: { color: "#4a4e53", rough: 0.35, metal: 0.7 }, frame: { color: "#33373b", rough: 0.45, metal: 0.2 }, glass: { rough: 0.04 }, glassLit: { rough: 0.04 },
  sill: { color: "#55595e", rough: 0.4, metal: 0.6 }, doorExt: { color: "#3b2e25", rough: 0.55 }, doorInt: { color: "#efece6", rough: 0.6 }, metal: { color: "#1d1f21", rough: 0.35, metal: 0.8 },
  stair: { color: "#b3946c", rough: 0.6 }, prop: { color: "#9b8a74", rough: 0.8 }, trim: { rough: 0.8, tex: "trim" }, coping: { color: "#5d6166", rough: 0.4, metal: 0.6 }, fail: { color: "#dc2626", rough: 0.7 },
};

/** Weathering for walls (a shader patch, no extra textures): the splash zone at the foot is damp and darker, the top under the eave is
 *  slightly dirtier, and big slow patches of tone break up the flat finish. World-space, so it is the same on every wall and every house. */
function weather(m: THREE.MeshStandardMaterial, k: number) {
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWP;").replace("#include <begin_vertex>", "#include <begin_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vWP;")
      .replace("#include <map_fragment>", `#include <map_fragment>
      { float foot = 1.0 - smoothstep(0.0, 0.9, vWP.y);
        float n = 0.5 + 0.25 * sin(vWP.x * 0.9 + sin(vWP.z * 0.7) * 2.0) + 0.25 * sin((vWP.z + vWP.x) * 0.43 + vWP.y * 0.5);
        float streak = 0.5 + 0.5 * sin(vWP.x * 7.1 + vWP.z * 6.3) * sin(vWP.y * 0.8 + 1.0);
        diffuseColor.rgb *= (1.0 - ${k.toFixed(2)} * 0.55 * foot) * (0.9 + 0.2 * n) * (1.0 - ${k.toFixed(2)} * 0.12 * streak * smoothstep(0.5, 3.5, vWP.y)); }`);
  };
  m.customProgramCacheKey = () => `weather${k}`;
}

export type ArchMaterials = Record<MatKey, THREE.Material> & { lawn: THREE.MeshStandardMaterial; gravel: THREE.MeshStandardMaterial; paving: THREE.MeshStandardMaterial };
let cache: ArchMaterials | null = null;
/** One shared set for the whole session (drawn on first use, ~20 ms). */
export function archMaterials(): ArchMaterials {
  if (cache) return cache;
  const make = (s: Spec) => {
    const t = s.tex ? TEX[s.tex] : undefined, n = t?.size ?? 256;
    const map = t ? canvasTex(`${s.tex}`, t.color, n, t.m, true) : null, bump = t?.bump ? canvasTex(`${s.tex}`, t.bump, n, t.m, false) : null;
    return new THREE.MeshStandardMaterial({ color: s.color ?? "#ffffff", roughness: s.rough, metalness: s.metal ?? 0, map, bumpMap: bump, bumpScale: s.bump ?? 1, envMapIntensity: 0.9 });
  };
  const out = Object.fromEntries(Object.entries(SPEC).map(([k, s]) => [k, make(s)])) as unknown as ArchMaterials;
  // glass: an opaque, glossy pane (no transparency and no depth-write trickery, so nothing behind the house can show through it):
  // a dark tint that mirrors the HDRI sky at grazing angles, and, for lit windows, a warm interior as emissive light (ArchHouse sets the strength)
  const pane = { color: "#0b1319", roughness: 0.03, metalness: 0, envMapIntensity: 3, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1 };
  out.glass = new THREE.MeshPhysicalMaterial(pane);
  const glow = TEX.glow!, lit = new THREE.MeshPhysicalMaterial({ ...pane, emissive: new THREE.Color("#ffffff"), emissiveMap: canvasTex("glow", glow.color, glow.size ?? 128, glow.m, true), emissiveIntensity: 1.3 });
  out.glassLit = lit;
  for (const k of ["plaster", "timber", "brick", "concrete", "plinth"] as const) weather(out[k] as THREE.MeshStandardMaterial, k === "plinth" || k === "concrete" ? 0.3 : 1);
  out.lawn = make({ rough: 1, tex: "lawn" }); out.gravel = make({ rough: 1, tex: "gravel", bump: 0.4, color: "#c4c8cc" }); out.paving = make({ rough: 0.85, tex: "paving" });
  cache = out;
  return out;
}
