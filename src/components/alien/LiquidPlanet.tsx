"use client";
// Worlds as levitating liquid metal (concept c0): chrome or obsidian with oil-slick thin-film swirls, reflecting the
// alien environment. The surface is a procedural hierarchy evaluated per pixel in object space, so it never turns into a
// stretched texture: domain-warped continents (dark mirror pools vs chrome) -> Voronoi plates whose seams glow like
// glyph cuts -> etched circuitry in two octaves -> traces that resolve into micro-glyph text -> a grain sparkle.
// Every layer fades out once it gets smaller than a pixel (fwidth), and the octave budget (uOct) grows with the camera's
// closeness and the quality level: the overview pays for 3 octaves, a close-up for 8. The relief is turned into normals
// from the procedural height's screen derivatives (bump mapping), the chrome's highlights are anisotropic and follow the
// flow. Every shader term is bounded (bloom NaN rule).
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { HOLO, useAlienEnv } from "./env";

/** Shared GLSL noise (no uniforms, no derivatives: safe in vertex shaders too). */
export const NOISE = /* glsl */ `
vec3 h33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float gnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  #define G(o) dot(h33(i + o) * 2.0 - 1.0, f - o)
  return mix(mix(mix(G(vec3(0,0,0)), G(vec3(1,0,0)), u.x), mix(G(vec3(0,1,0)), G(vec3(1,1,0)), u.x), u.y),
             mix(mix(G(vec3(0,0,1)), G(vec3(1,0,1)), u.x), mix(G(vec3(0,1,1)), G(vec3(1,1,1)), u.x), u.y), u.z);
  #undef G
}
// fbm whose octaves stop at the budget and fade once their wavelength drops under ~2 px (fw = pixel footprint)
float fbm(vec3 p, float fw, float oct) {
  float a = 0.5, s = 0.0, f = 1.0;
  for (int i = 0; i < 8; i++) {
    float k = clamp(oct - float(i), 0.0, 1.0) * (1.0 - smoothstep(0.25, 0.5, f * fw));
    if (k <= 0.0) break;
    s += a * k * gnoise(p * f); f *= 2.03; a *= 0.5;
    p = p.yzx + vec3(1.7, -2.3, 0.9);
  }
  return s;
}
`;
/** Where a world's micro-world lives (0..1), from its pattern family: band edges, marble veins, crater rims, land.
 *  Shared by the surface shader (night-side cities) and the instanced structures (vertex shader), so both agree. */
export const SITE = /* glsl */ `
uniform float uFam; uniform vec3 uSeed;
float famSite(vec3 n) {
  vec3 q = n + uSeed;
  if (uFam < -0.5) return smoothstep(-0.05, 0.2, fbm(n * 2.2 + vec3(3.1, 0.7, -1.9), 0.0, 3.0)); // chrome: the raised continents
  if (uFam < 0.5) { // banded: settlements ride the band edges, clear of the poles
    float wv = fbm(q * 2.4, 0.0, 3.0), y = n.y + wv * 0.13;
    float b = 0.5 + 0.5 * sin(y * 15.0 + sin(y * 5.0 + uSeed.x) * 1.8);
    return exp(-pow((b - 0.5) * 4.0, 2.0)) * (1.0 - smoothstep(0.7, 0.92, abs(n.y)));
  }
  if (uFam < 1.5) { // marbled: along the veins
    vec3 w2 = vec3(fbm(q * 1.7, 0.0, 3.0), fbm(q * 1.7 + 5.2, 0.0, 3.0), 0.0);
    float m = fbm(q * 2.1 + w2 * 2.4, 0.0, 4.0);
    return 1.0 - smoothstep(0.03, 0.16, abs(m - 0.08));
  }
  if (uFam < 2.5) { // cratered: rings of structures on the big crater rims, sparse on the plains
    vec3 cp = q * 4.0, ci = floor(cp), cf = fract(cp); float d1 = 8.0; vec3 id = vec3(0.0);
    for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec3 o3 = vec3(x, y, z), r = o3 + h33(ci + o3) * 0.8 + 0.1 - cf;
      float d = dot(r, r); if (d < d1) { d1 = d; id = ci + o3; }
    }
    float rad = 0.18 + 0.22 * h13(id * 1.7), d = sqrt(d1) / rad;
    return exp(-pow((d - 1.08) * 5.0, 2.0)) * step(0.45, h13(id + 3.1)) + 0.12;
  }
  float land = fbm(q * 1.9, 0.0, 5.0); // oceanic: on land, off the ice
  return smoothstep(0.05, 0.14, land) * (1.0 - smoothstep(0.66, 0.78, abs(n.y) + land * 0.15));
}
// cities: famSite broken into distinct clusters with dark country between (fw = pixel footprint; 0 = full detail)
float cityDens(vec3 n, float fw) { return smoothstep(0.25, 0.7, famSite(n) * (0.2 + 1.3 * smoothstep(-0.05, 0.3, fbm(n * 6.0 + uSeed * 3.0, fw * 6.0, 3.0)))); }
`;
/** Shared GLSL: hash, gradient noise and the surface hierarchy. `surf` returns the height and fills the layer masks. */
const SURF = /* glsl */ `
uniform float uTime; uniform float uOct; uniform float uDetail; varying vec3 vLq;
float gPool, gSeam, gCirc, gGlyph, gSpark, gFlowA, gH, gShore;
${NOISE}
${SITE}
// 3x5 dot glyph at cell c, sub-cell f in [0,1)
float glyph(vec2 c, vec2 f) {
  vec2 s = floor(f * vec2(4.0, 6.0));
  if (s.x > 2.0 || s.y > 4.0) return 0.0;
  return step(0.45, h12(c * 7.31 + s * 1.7));
}
float surf(vec3 p, float fw) {
  vec3 n = normalize(p);
  float t = uTime * 0.05;
  // continents: two-level domain warp, the liquid slowly flowing
  vec3 w = vec3(gnoise(n * 1.6 + vec3(0.0, t, 0.0)), gnoise(n * 1.6 + vec3(5.2, -t, 1.3)), gnoise(n * 1.6 + vec3(-3.1, 2.7, t)));
  vec3 q = n * 2.2 + w * 1.4;
  float c = fbm(q, fw * 2.2, 2.0);
  gFlowA = atan(w.y, w.x) * 2.0 + c * 6.0;
  gPool = smoothstep(-0.04, 0.1, c);
  // plates: Voronoi cells over the warped sphere, their seams cut deep and glowing
  vec3 vp = n * 3.2 + w * 0.45, vi = floor(vp), vf = fract(vp);
  float d1 = 8.0, d2 = 8.0; vec3 cid = vec3(0.0);
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(x, y, z), r = o + h33(vi + o) - vf;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; cid = vi + o; } else if (d < d2) d2 = d;
  }
  float seamW = sqrt(d2) - sqrt(d1);
  float sw = max(fw * 3.2 * 1.5, 0.014);
  gSeam = (1.0 - smoothstep(sw * 0.5, sw, seamW)) * smoothstep(-0.05, 0.15, gnoise(n * 2.3 + vec3(7.1, 3.3, -2.0))); // only some seams are cut: fragments, not a football
  // relief: the fine octaves ride on the plates
  float h = c * 0.7 + fbm(n * 9.0 + w, fw * 18.0, uOct) * 0.3 * (0.4 + 0.6 * gPool) - gSeam * 0.12; // bump = derivative: fade an octave early, no crawl
  float shore = exp(-pow((c - 0.08) * 9.0, 2.0)); gFlowA += shore * 2.0; gSpark = shore; // pool shores: where the oil film is thickest
  gCirc = 0.0; gGlyph = 0.0; float shoreK = gSpark; gSpark = 0.0;
  if (uDetail > 0.01) {
    // etched circuitry on a cube projection: one trace per cell (straight, turn or via), two octaves
    vec3 a = abs(n);
    vec2 uv = a.x > a.y && a.x > a.z ? n.yz / a.x : a.y > a.z ? n.xz / a.y : n.xy / a.z;
    float face = a.x > a.y && a.x > a.z ? 1.0 : a.y > a.z ? 2.0 : 3.0;
    float plate = h13(cid), fwu = fwidth(uv.x) + fwidth(uv.y); // derivatives outside the loop (non-uniform exits)
    for (int o = 0; o < 2; o++) {
      float S = o == 0 ? 28.0 : 112.0;
      vec2 g = uv * S, ci = floor(g), cf = fract(g) - 0.5;
      float px = fwu * S;
      float fade = (1.0 - smoothstep(0.12, 0.3, px)) * step(0.4, plate + float(o) * 0.25) * (0.35 + 0.65 * gPool);
      if (fade <= 0.0) break;
      float k = h12(ci + face * 101.0 + float(o) * 37.0);
      float d = k < 0.35 ? abs(cf.y) : k < 0.7 ? abs(cf.x) : k < 0.92 ? min(max(abs(cf.y), -cf.x), max(abs(cf.x), -cf.y)) : abs(length(cf) - 0.12);
      float lw = 0.022 + px * 0.5;
      float line = (1.0 - smoothstep(lw - px * 0.5, lw + px * 0.5, d)) * step(0.15, h12(ci * 3.1 + 9.0));
      gCirc = max(gCirc, line * fade * (o == 0 ? 1.0 : 0.6));
      h -= line * fade * (o == 0 ? 0.022 : 0.01);
      if (o == 0 && k < 0.35) { // a straight trace resolves into a strip of micro-glyphs when close
        vec2 gg = vec2((cf.x + 0.5) * 8.0, (cf.y + 0.11) / 0.22);
        float gpx = fwu * S * 8.0 * 4.0;
        float gf = (1.0 - smoothstep(0.35, 0.7, gpx)) * step(0.0, gg.y) * step(gg.y, 1.0);
        gGlyph = max(gGlyph, gf * glyph(floor(gg) + ci * 19.0, vec2(fract(gg.x), gg.y)));
      }
    }
    // grain sparkle: sub-millimetre crystals glinting as they turn
    vec3 sg = n * 420.0, sc = floor(sg);
    float spx = fwidth(sg.x) + fwidth(sg.y);
    float r = h13(sc);
    gSpark = pow(r, 70.0) * (0.6 + 0.4 * sin(uTime * 0.5 + r * 80.0)) * (1.0 - smoothstep(0.25, 0.6, spx)) * (1.0 - smoothstep(0.32, 0.5, length(fract(sg) - 0.5)));
  }
  gH = h; gShore = shoreK;
  return h;
}
// Surface identity (c8): each world gets a pattern family and a 3-colour palette. -1 = the legacy liquid chrome.
// 0 banded gas giant, 1 marbled, 2 cratered, 3 oceanic. Far: palette + silhouette; mid: the pattern; close: the
// circuitry above takes over. Every high-frequency term fades by its pixel footprint (fw), so nothing shimmers.
uniform vec3 uPA; uniform vec3 uPB; uniform vec3 uPC;
float gOcean;
vec3 famColor(vec3 p, float fw) {
  vec3 n = normalize(p), q = n + uSeed;
  gOcean = 0.0;
  if (uFam < 0.5) { // banded: latitude bands bent by a slow warp, finer belts fading out with distance, one storm oval
    float wv = fbm(q * 2.4, fw * 2.4, 3.0);
    float y = n.y + wv * 0.13;
    float b = 0.5 + 0.5 * sin(y * 15.0 + sin(y * 5.0 + uSeed.x) * 1.8);
    float fine = (0.5 + 0.5 * sin(y * 47.0 + wv * 9.0)) * (1.0 - smoothstep(0.35, 0.9, 47.0 * fw));
    vec3 col = mix(uPA, uPB, smoothstep(0.2, 0.8, b));
    col = mix(col, uPC, fine * 0.28 + smoothstep(0.85, 1.0, b) * 0.3);
    vec3 D = normalize(vec3(cos(uSeed.x * 3.0), -0.32, sin(uSeed.x * 3.0)));
    vec3 e = n - D; float sp = length(vec3(e.x, e.y * 2.3, e.z));
    float storm = 1.0 - smoothstep(0.09, 0.16, sp);
    col = mix(col, mix(uPC, uPB, 0.5 + 0.5 * sin(sp * 60.0 + wv * 4.0)), storm * 0.85);
    gH = wv * 0.12 + b * 0.05;
    return col;
  }
  if (uFam < 1.5) { // marbled: domain-warped swirls, veins of the third colour
    vec3 w2 = vec3(fbm(q * 1.7, fw * 1.7, 3.0), fbm(q * 1.7 + 5.2, fw * 1.7, 3.0), 0.0);
    float m = fbm(q * 2.1 + vec3(w2.xy, 0.0) * 2.4, fw * 2.1, 4.0);
    vec3 col = mix(uPA, uPB, smoothstep(-0.28, 0.28, m));
    col = mix(col, uPC, (1.0 - smoothstep(0.0, 0.07, abs(m - 0.08))) * 0.7);
    gH = m * 0.35;
    return col;
  }
  if (uFam < 2.5) { // cratered: mottled rock, two sizes of craters (dark floor, bright rim)
    float base = fbm(q * 3.0, fw * 3.0, 4.0);
    vec3 col = mix(uPA, uPB, smoothstep(-0.3, 0.35, base));
    float hh = base * 0.25;
    for (int o = 0; o < 2; o++) {
      float S = o == 0 ? 4.0 : 11.0;
      vec3 cp = q * S, ci = floor(cp), cf = fract(cp);
      float d1 = 8.0; vec3 id = vec3(0.0);
      for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec3 o3 = vec3(x, y, z), r = o3 + h33(ci + o3) * 0.8 + 0.1 - cf;
        float d = dot(r, r); if (d < d1) { d1 = d; id = ci + o3; }
      }
      float rad = 0.18 + 0.22 * h13(id * 1.7), d = sqrt(d1) / rad, k = step(0.45, h13(id + 3.1));
      float fade = (1.0 - smoothstep(0.25, 0.6, fw * S / rad)) * k;
      float fl = 1.0 - smoothstep(0.75, 0.95, d), rim = exp(-pow((d - 1.0) * 5.0, 2.0));
      col = mix(col, uPC, fl * 0.65 * fade);
      col += uPA * rim * 0.22 * fade;
      hh += (rim * 0.08 - fl * 0.12) * fade * (o == 0 ? 1.0 : 0.5);
    }
    gH = hh;
    return col;
  }
  // oceanic: deep water, continents, ice caps and thin cloud wisps
  float land = fbm(q * 1.9, fw * 1.9, 5.0);
  float coast = smoothstep(0.02, 0.06, land);
  gOcean = 1.0 - coast;
  vec3 col = mix(uPB * (0.6 + 0.4 * smoothstep(-0.4, 0.02, land)), uPA * (0.8 + 0.4 * land), coast);
  col = mix(col, uPC, smoothstep(0.78, 0.86, abs(n.y) + land * 0.15));
  float cl = fbm(q * 3.3 + vec3(uTime * 0.004, 0.0, 0.0), fw * 3.3, 4.0);
  col = mix(col, vec3(0.92, 0.94, 0.97), smoothstep(0.08, 0.35, cl) * 0.55);
  gH = max(land, 0.0) * 0.5;
  return col;
}
`;

/** Night-side cities and the cursor x-ray (fragment only). Cities: arterial and street grids on a cube projection where
 *  famSite says people live, lit only away from the CORE; far they melt into a soft glow (their mean), close they resolve
 *  into lines, lit blocks and moving traffic. X-ray: inside a soft lens under the cursor the crust turns to a survey grid
 *  and the view ray is intersected analytically with a mantle shell and a core, so the internals have real depth. */
const CITY = /* glsl */ `
uniform float uCity; uniform vec3 uLens; uniform float uLensK; uniform float uLensR; uniform vec3 uCamL;
vec3 cityLights(vec2 uv, float face, float fwu, float dens, float t) {
  vec3 c = vec3(1.0, 0.86, 0.66) * dens * dens * 0.05; // the sky glow over a city
  for (int o = 0; o < 2; o++) { // arterials, then streets; every block edge is its own segment, so the network is irregular
    float S = o == 0 ? 40.0 : 160.0, px = fwu * S;
    vec2 g = uv * S;
    float vis = 1.0 - smoothstep(0.25, 0.6, px);
    float thr = o == 0 ? 0.62 - 0.3 * dens : 1.0 - dens * 0.7;
    float rI = floor(g.y + 0.5), cI = floor(g.x + 0.5);
    float rH = h12(vec2(rI, floor(g.x)) + face * 13.0 + S), cH = h12(vec2(cI + 71.0, floor(g.y)) + face * 7.0 + S);
    float dy = abs(fract(g.y + 0.5) - 0.5), dx = abs(fract(g.x + 0.5) - 0.5), lw = 0.03 + 0.5 * px;
    float rl = (1.0 - smoothstep(lw - px * 0.5, lw + px * 0.5, dy)) * step(thr, rH);
    float cl = (1.0 - smoothstep(lw - px * 0.5, lw + px * 0.5, dx)) * step(thr, cH);
    vec3 tint = o == 0 ? vec3(1.0, 0.86, 0.66) : vec3(0.8, 0.86, 1.0);
    float dist = 0.35 + 0.65 * h12(floor(g / 5.0) + face * 5.0 + S); // districts: some bright, some asleep
    c += tint * (max(rl, cl) * vis + (1.0 - vis) * 0.3) * dens * dist * (o == 0 ? 0.3 : 0.1); // far: the lines' mean, a soft glow
    if (o == 0) {
      float tv = 1.0 - smoothstep(0.1, 0.25, px); // traffic: close only, both ways on the arterials
      if (tv > 0.0) {
        float ur = g.x * 3.0 + t * (rH > 0.81 ? 0.35 : -0.35) + rH * 17.0, uc = g.y * 3.0 + t * (cH > 0.81 ? 0.35 : -0.35) + cH * 17.0;
        float cw = 0.06 + px * 3.0;
        float car = rl * (1.0 - smoothstep(cw * 0.5, cw, abs(fract(ur) - 0.5))) * step(0.4, h12(vec2(floor(ur), rI)))
                  + cl * (1.0 - smoothstep(cw * 0.5, cw, abs(fract(uc) - 0.5))) * step(0.4, h12(vec2(floor(uc), cI)));
        c += vec3(1.0, 0.97, 0.92) * car * tv * dens * 0.9;
      }
      vec2 bg = uv * S * 4.0; float bpx = px * 4.0; vec2 bf = abs(fract(bg) - 0.5); // lit blocks between the streets
      float blk = step(1.0 - dens * 0.3, h12(floor(bg) + face * 3.0)) * (1.0 - smoothstep(0.16, 0.16 + bpx, max(bf.x, bf.y)));
      c += vec3(1.0, 0.9, 0.74) * blk * (1.0 - smoothstep(0.3, 0.7, bpx)) * dens * 0.3;
    }
  }
  return c;
}
vec2 sph(vec3 ro, vec3 rd, float r) { float b = dot(ro, rd), c = dot(ro, ro) - r * r, h = b * b - c; if (h < 0.0) return vec2(-1.0); h = sqrt(h); return vec2(-b - h, -b + h); }
// latitude / longitude survey lines through h (w = half-width in unit space)
float gridL(vec3 h, float n, float m, float w) {
  float r = max(length(h), 1e-4), rho = length(h.xz);
  float la = abs(fract(h.y / r * n * 0.5 + 0.5) - 0.5) * 2.0 / n * r;
  float lo = abs(fract(atan(h.z, h.x) / 6.2831853 * m + 0.5) - 0.5) * 6.2831853 / m * rho;
  return max(1.0 - smoothstep(w * 0.5, w, la), 1.0 - smoothstep(w * 0.5, w, lo));
}
vec3 xray(vec3 p, vec3 rd, float w, float t, float cw) {
  vec3 c = vec3(0.004, 0.01, 0.03) + vec3(0.45, 0.62, 1.0) * gridL(p, 18.0, 36.0, w) * 0.12; // the crust: a survey grid
  c += vec3(0.5, 0.66, 1.0) * (1.0 - smoothstep(0.0, cw, abs(fract(gH * 14.0 + 0.5) - 0.5))) * 0.14; // height contours, ~1 px
  vec2 k = sph(p, rd, 0.34), m = sph(p, rd, 0.7);
  float tc = k.x > 0.0 ? k.x : 1e3;
  if (m.x > 0.0) for (int i = 0; i < 2; i++) { // mantle shell, front and back: a denser grid and three glowing conduits
    float ti = i == 0 ? m.x : m.y;
    if (ti > tc) continue;
    vec3 h = p + rd * ti; float fade = i == 0 ? 1.0 : 0.4;
    c += vec3(0.42, 0.52, 1.0) * gridL(h, 30.0, 60.0, w) * 0.16 * fade;
    for (int j = 0; j < 3; j++) {
      float fj = float(j);
      vec3 ax = normalize(vec3(sin(fj * 2.1 + 0.3), cos(fj * 1.7), sin(fj * 3.7 + 1.0)));
      vec3 e1 = normalize(cross(ax, vec3(0.3, 1.0, 0.2))), e2 = cross(ax, e1);
      float band = 1.0 - smoothstep(w, w * 3.0 + 0.006, abs(dot(h, ax)));
      float pulse = pow(0.5 + 0.5 * sin(atan(dot(h, e2), dot(h, e1)) * 5.0 - t * 1.4 + fj * 2.0), 10.0);
      c += mix(vec3(0.55, 0.5, 1.0), vec3(0.9, 0.95, 1.0), pulse) * band * (0.3 + 0.9 * pulse) * fade;
    }
  }
  if (k.x > 0.0) { // the core: a pearl sphere, its own fine grid turning slowly
    vec3 h = p + rd * k.x; float fr = 1.0 - abs(dot(normalize(h), rd));
    float ca = cos(t * 0.2), sa = sin(t * 0.2); vec3 hr = vec3(h.x * ca - h.z * sa, h.y, h.x * sa + h.z * ca);
    c += mix(vec3(0.5, 0.6, 1.0), vec3(0.9, 0.94, 1.0), fr) * (0.14 + 0.45 * fr * fr) + vec3(0.8, 0.88, 1.0) * gridL(hr, 12.0, 24.0, w) * 0.22;
  }
  for (int j = 0; j < 6; j++) { // spokes: radial conduits from the core to the crust, energy climbing them
    float fj = float(j);
    vec3 ax = normalize(vec3(sin(fj * 1.9 + 0.4), cos(fj * 2.6 + 0.2) * 0.8, cos(fj * 1.3 + 2.0)));
    float b = dot(rd, ax), e = dot(p, ax), d0 = dot(p, rd);
    float tt = (b * e - d0) / max(1.0 - b * b, 1e-4);
    float ss = clamp(e + b * tt, 0.34, 1.0);
    tt = max(dot(ax * ss - p, rd), 0.0);
    float dist = length(p + rd * tt - ax * ss);
    float on = (1.0 - smoothstep(w * 0.7, w * 2.5 + 0.005, dist)) * step(tt, tc);
    c += vec3(0.55, 0.66, 1.0) * on * (0.2 + 0.7 * pow(0.5 + 0.5 * sin(ss * 16.0 - t * 2.2 + fj), 12.0));
  }
  return c;
}
`;

/** The planet's surface material. `extra` is chained (the HUD's rim light). Returns the material; animate `uTime`,
 *  set `uDetail` (0 overview .. 1 close-up, see planetDetail) every frame. */
/** A world's surface identity: pattern family (see famColor) and palette. Omit for the legacy liquid chrome. */
export type SurfaceLook = { fam: 0 | 1 | 2 | 3; pal: readonly [string, string, string]; seed: number };
// per family: metalness, roughness, clearcoat, env reflection, iridescence, bump scale
const FAM = [
  { metal: 0.0, rough: 0.6, coat: 0.25, env: 0.18, iri: 0.12, bump: 0.25 }, // banded gas giant: soft, matte
  { metal: 0.25, rough: 0.38, coat: 0.5, env: 0.35, iri: 0.25, bump: 0.5 },  // marbled: polished stone
  { metal: 0.05, rough: 0.85, coat: 0.0, env: 0.12, iri: 0.0, bump: 1.4 },   // cratered rock
  { metal: 0.0, rough: 0.55, coat: 0.4, env: 0.25, iri: 0.1, bump: 0.6 },   // oceanic (water is glossier, below)
] as const;

export function useLiquidMetal(color: string, obsidian: boolean, size: number, extra?: (s: THREE.WebGLProgramParametersWithUniforms) => void, look?: SurfaceLook) {
  const env = useAlienEnv();
  const { mat, u } = useMemo(() => {
    const f = look ? FAM[look.fam] : null;
    const sd = look?.seed ?? 0;
    const u = { uTime: { value: 0 }, uLq: { value: size }, uDetail: { value: 0 }, uOct: { value: 3 }, uFar: { value: 1 }, uTint: { value: new THREE.Color(color) }, uPoolTint: { value: new THREE.Color(color).multiplyScalar(obsidian ? 0.4 : 0.025) },
      uFam: { value: look ? look.fam : -1 }, uSeed: { value: new THREE.Vector3((sd * 1.37) % 7, (sd * 2.71) % 5, (sd * 0.61) % 3) },
      uPA: { value: new THREE.Color(look?.pal[0] ?? color) }, uPB: { value: new THREE.Color(look?.pal[1] ?? color) }, uPC: { value: new THREE.Color(look?.pal[2] ?? color) },
      uIdent: { value: 1 }, // 1 legacy strong identity rim; the galaxy sets 0 (thin atmosphere)
      uBump: { value: f?.bump ?? 1 }, uChrome: { value: f ? 0 : 1 },
      // micro-world: night-side cities (0 off .. 1), and the cursor x-ray lens (unit-sphere centre, strength, radius, camera)
      uCity: { value: 0 }, uLens: { value: new THREE.Vector3(0, 0, 1) }, uLensK: { value: 0 }, uLensR: { value: 0.4 }, uCamL: { value: new THREE.Vector3(0, 0, 4) } };
    const tint = new THREE.Color(color);
    const mat = new THREE.MeshPhysicalMaterial(f ? {
      color: "#ffffff", metalness: f.metal, roughness: f.rough, clearcoat: f.coat, clearcoatRoughness: 0.45, // soft: the env slits must not print hard lines on a world
      iridescence: f.iri, iridescenceIOR: 1.4, iridescenceThicknessRange: [200, 600],
      emissive: color, emissiveIntensity: 0, envMapIntensity: f.env,
    } : {
      color: obsidian ? tint.clone().multiplyScalar(0.07) : tint.clone().lerp(new THREE.Color("#ffffff"), 0.55),
      metalness: 1, roughness: obsidian ? 0.14 : 0.06, clearcoat: obsidian ? 1 : 0.5, clearcoatRoughness: 0.04,
      iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [120, 900],
      anisotropy: 0.4, // brushed-chrome streaks; the direction follows the flow (injected below)
      emissive: color, emissiveIntensity: 0, envMapIntensity: obsidian ? 2.4 : 1.15,
    });
    mat.onBeforeCompile = (s) => {
      extra?.(s);
      Object.assign(s.uniforms, u);
      s.vertexShader = s.vertexShader
        .replace("void main() {", "uniform float uTime; uniform float uLq; uniform float uChrome; varying vec3 vLq;\nvoid main() {")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          vLq = position / max(uLq, 1e-3);
          transformed += objectNormal * uLq * 0.018 * uChrome * (sin(vLq.x * 5.0 + uTime * 0.9) * sin(vLq.y * 4.0 - uTime * 0.7) + sin(vLq.z * 6.0 + uTime * 1.1) * 0.6);`);
      s.fragmentShader = s.fragmentShader
        .replace("void main() {", `uniform float uLq; uniform vec3 uTint; uniform vec3 uPoolTint; uniform float uFar; uniform float uIdent; uniform float uBump; uniform float uChrome;\n${SURF}\n${CITY}\n${HOLO}\nvoid main() {`)
        .replace("#include <color_fragment>", `#include <color_fragment>
          float fwq = length(fwidth(vLq));
          surf(vLq, fwq);
          if (uFam < -0.5) diffuseColor.rgb *= mix(uPoolTint, vec3(1.0), gPool); // continents: dark mirror pools in the chrome
          else { float hs = gH; diffuseColor.rgb *= famColor(vLq, fwq); gH += (hs - gH) * 0.25 * uDetail; } // identity at every range; the alien relief joins up close`)
        .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
          { // bump from the procedural height: screen derivatives of h (world units), Mikkelsen's surface gradient
            float h = gH * uLq * 0.06 * uBump;
            vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
            vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
            float det = dot(sx, r1);
            vec3 gr = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
            vec3 nb = abs(det) * normal - gr;
            normal = dot(nb, nb) > 1e-20 ? normalize(nb) : normal;
            roughnessFactor = clamp(roughnessFactor * mix(1.0, 0.6 + 0.8 * (1.0 - gPool), uChrome) * (1.0 - 0.7 * gOcean) + gSeam * 0.25 + gCirc * 0.12, 0.03, 1.0);
          }`)
        .replace("vec2 anisotropyV = anisotropyVector;", "float ca = cos(gFlowA), sa = sin(gFlowA); vec2 anisotropyV = mat2(ca, sa, -sa, ca) * anisotropyVector * (0.5 + 0.5 * gPool);")
        .replace("#include <lights_physical_fragment>", `#include <lights_physical_fragment>
          #ifdef USE_IRIDESCENCE
          material.iridescence = clamp(0.25 + 0.75 * gShore + 0.3 * (1.0 - gPool), 0.0, 1.0) * mix(0.3, 1.0, uChrome);
          material.iridescenceThickness = mix(iridescenceThicknessMinimum, iridescenceThicknessMaximum, clamp(0.5 + 0.5 * sin(gH * 9.0 + gFlowA * 0.5), 0.0, 1.0));
          #endif`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
          { float f = 1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);
            vec3 hc = holo(vLq.y * 0.3 + gFlowA * 0.04 + uTime * 0.02);
            float wave = 0.5 + 0.5 * sin(dot(vLq, vec3(3.0, 5.0, 2.0)) * 2.0 - uTime * 1.2);
            float seamK = mix(0.06 + 0.35 * uDetail, 1.0, uChrome); // identity worlds: the glyph cuts are a mid/close detail
            totalEmissiveRadiance += mix(hc, uTint, 0.3) * gSeam * (0.03 + 0.9 * pow(wave, 6.0)) * seamK;       // glyph seams
            totalEmissiveRadiance += hc * gCirc * (0.02 + 0.5 * pow(wave, 8.0)) * uDetail;          // circuitry: a pulse runs through it
            totalEmissiveRadiance += vec3(0.75, 0.95, 1.0) * gGlyph * 0.9 * uDetail;
            totalEmissiveRadiance += mix(vec3(1.0), hc, 0.5) * gSpark * 2.0;
            totalEmissiveRadiance += hc * pow(f, 2.5) * 0.55 * mix(0.15, 1.0, uChrome);
            // identity colour from the overview: uIdent 1 = the legacy strong rim (worlds), 0 = a thin atmosphere rim (galaxy)
            totalEmissiveRadiance += mix(mix(uTint, vec3(0.75, 0.82, 1.0), 0.35) * (pow(f, 2.6) * 1.1 + 0.04), uTint * (pow(f, 1.8) * 1.4 + 0.12), uIdent) * uFar;
            totalEmissiveRadiance += holo(gFlowA * 0.08 + gH * 2.0) * (1.0 - gPool) * 0.1 * uChrome; // thin-film edge sheen
            vec3 nq = normalize(vLq);
            if (uCity > 0.001) { // night side (away from the CORE at the world origin): the cities come on
              vec3 Lv = normalize(viewMatrix[3].xyz + vViewPosition);
              float night = smoothstep(0.05, -0.25, dot(nonPerturbedNormal, Lv));
              vec3 a3 = abs(nq);
              vec2 cuv = a3.x > a3.y && a3.x > a3.z ? nq.yz / a3.x : a3.y > a3.z ? nq.xz / a3.y : nq.xy / a3.z;
              float cface = a3.x > a3.y && a3.x > a3.z ? 1.0 + step(nq.x, 0.0) : a3.y > a3.z ? 3.0 + step(nq.y, 0.0) : 5.0 + step(nq.z, 0.0);
              float cfw = fwidth(cuv.x) + fwidth(cuv.y);
              float dens = cityDens(nq, fwq);
              if (dens > 0.0) { // no derivatives inside: safe in this non-uniform branch
                vec3 cl = cityLights(cuv, cface, cfw, dens, uTime);
                totalEmissiveRadiance += cl * night * uCity;
                // by day the same city is built ground: a darker, cooler footprint whose streets read as asphalt lines
                diffuseColor.rgb *= 1.0 - uCity * (1.0 - night) * clamp(dens * 0.2 + dot(cl, vec3(0.3, 0.5, 0.2)) * 1.4, 0.0, 0.5);
              }
            }
            if (uLensK > 0.001) { // cursor x-ray: a soft lens that reveals the world's blueprint
              float cw = min(fwidth(gH * 14.0) * 1.2, 0.5);
              float ld = length(nq - uLens) / max(uLensR, 1e-3);
              float lens = uLensK * (1.0 - smoothstep(0.7, 1.0, ld));
              if (lens > 0.0) {
                totalEmissiveRadiance *= 1.0 - 0.85 * lens;
                totalEmissiveRadiance += xray(vLq, normalize(vLq - uCamL), fwq * 0.9 + 0.0006, uTime, cw) * lens;
                diffuseColor.rgb *= 1.0 - 0.94 * lens;
                roughnessFactor = mix(roughnessFactor, 1.0, lens); metalnessFactor = mix(metalnessFactor, 0.0, lens);
              }
              totalEmissiveRadiance += vec3(0.7, 0.8, 1.0) * uLensK * exp(-pow((ld - 1.0) * 26.0, 2.0)) * 0.35; // the lens bezel
            } }`); // thin-film edge sheen
    };
    return { mat, u };
  }, [color, obsidian, size, extra, look]); // look: a module constant per world
  useEffect(() => { mat.envMap = env; mat.needsUpdate = true; }, [mat, env]);
  useEffect(() => () => mat.dispose(), [mat]);
  return { mat, u };
}

/* ---------- thought cluster: a shell of synapse points, dense at the surface, thinning outward ----------
   A share of the points are surface crawlers: tiny, skimming the liquid metal, visible only up close (uNear). */
const VS = /* glsl */ `
attribute float aSeed; uniform float uTime; uniform float uScale; uniform float uR; uniform float uGlow; uniform float uNear; uniform float uNorm; uniform vec3 uColor;
varying vec3 vC; varying float vA;
${HOLO}
vec3 rot(vec3 p, vec3 k, float a) { float c = cos(a), s = sin(a); return p * c + cross(k, p) * s + k * dot(k, p) * (1.0 - c); }
void main() {
  float crawl = step(fract(aSeed * 13.7), 0.45);
  vec3 k = normalize(vec3(sin(aSeed * 31.0), 1.6, cos(aSeed * 17.0)));
  vec3 d = rot(position, k, uTime * (0.12 + aSeed * 0.3 + crawl * 0.25) * (aSeed > 0.5 ? 1.0 : -1.0));
  float s = fract(aSeed * 97.31);
  float r = uR * mix(1.12 + 0.85 * s * s * s + 0.04 * sin(uTime * 2.0 + aSeed * 40.0), 1.035 + 0.03 * s, crawl);
  vec4 mv = modelViewMatrix * vec4(d * r, 1.0);
  float z = max(-mv.z, 0.1);
  float fire = pow(max(sin(uTime * (0.3 + aSeed * 0.4) + aSeed * 61.0), 0.0), 16.0); // a slow, rare glint
  // a faint pearl veil at the overview (the shell is many motes on a few pixels), the thought cluster up close
  vA = (0.35 + 0.6 * fire + 0.8 * uGlow) * (1.0 - s * 0.6) * smoothstep(1.0, 4.0, z) * mix(0.25 + 0.5 * uNear, uNear * 0.6, crawl) * uNorm;
  vC = mix(vec3(0.86, 0.9, 1.0), uColor, 0.22);
  vC = mix(vC, vec3(1.0), fire * 0.4);
  float px = uScale * mix(0.6 + 0.6 * fire, 0.35, crawl) / z;
  vA *= px < 1.5 ? (px / 1.5) * (px / 1.5) : 1.0; // never sub-pixel: fade by coverage
  gl_PointSize = clamp(px, 1.5, 6.0);
  gl_Position = projectionMatrix * mv;
}`;
const FS = /* glsl */ `varying vec3 vC; varying float vA;
void main(){ vec2 d = gl_PointCoord - 0.5; float a = max(1.0 - dot(d, d) * 4.0, 0.0);
  gl_FragColor = vec4(clamp(vC, 0.0, 1.0) * 1.3, clamp(a * a * vA, 0.0, 0.8)); }`;

export function ThoughtShell({ size, color, count, reduced, glow, near }: { size: number; color: string; count: number; reduced: boolean; glow: () => number; near: () => number }) {
  const geo = useMemo(() => {
    let sd = Math.round(size * 7919) + 1; // seeded: a quality switch keeps the first motes where they were (no pop)
    const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    const p = new Float32Array(count * 3), a = new Float32Array(count), v = new THREE.Vector3();
    for (let i = 0; i < count; i++) { v.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize(); p.set([v.x, v.y, v.z], i * 3); a[i] = r(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(a, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), size * 2.2);
    return g;
  }, [size, count]);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uScale: { value: 9 }, uR: { value: size }, uGlow: { value: 0 }, uNear: { value: 0 }, uNorm: { value: Math.min(2, 360 / Math.max(1, count)) }, uColor: { value: new THREE.Color(color) } },
  }), [size, color, count]);
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock, gl }) => {
    const g = glow(), n = near();
    mat.uniforms.uTime.value = reduced ? 5 : clock.elapsedTime;
    mat.uniforms.uScale.value = gl.getPixelRatio() * 16;
    mat.uniforms.uGlow.value = Number.isFinite(g) ? Math.min(1, Math.max(0, g)) : 0;
    mat.uniforms.uNear.value = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
  });
  return count > 0 ? <points geometry={geo} material={mat} /> : null;
}

/* ---------- holographic glyph-tick ring (c0): a hairline halo with crisp ticks, a finer tick octave and glyph text
   fading in up close, and beads of light orbiting on it. Ticks are anti-aliased with fwidth: crisp at any distance. */
const RING_VS = /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RING_FS = /* glsl */ `
uniform float uTime; uniform float uIn; uniform float uOut; uniform float uDetail; uniform vec3 uColor; varying vec2 vP;
${HOLO}
float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main() {
  float r = length(vP), a = atan(vP.y, vP.x) / 6.2831853 + 0.5;
  float x = (r - uIn) / (uOut - uIn);                       // 0 inner .. 1 outer edge
  float px = fwidth(x);
  float band = smoothstep(-px, px, x) * smoothstep(-px, px, 1.0 - x);
  float line = 1.0 - smoothstep(0.0, max(px * 1.5, 0.06), abs(x - 0.5) - 0.06);   // the hairline itself
  // ticks: 180 majors across the band, 720 minors on the inner half, fading in with detail and pixel size
  float A = a * 180.0, apx = fwidth(A);
  float maj = 1.0 - smoothstep(0.08 - apx, 0.08 + apx, abs(fract(A) - 0.5) - 0.42);
  maj *= step(0.0, x) * step(x, 0.42 + 0.3 * step(0.8, fract(a * 18.0))) * (1.0 - smoothstep(0.25, 0.5, apx)); // under ~3 px apart: fade, no moire
  float B = a * 720.0, bpx = fwidth(B);
  float mnr = (1.0 - smoothstep(0.1 - bpx, 0.1 + bpx, abs(fract(B) - 0.5) - 0.4)) * step(0.0, x) * step(x, 0.22) * (1.0 - smoothstep(0.3, 0.6, bpx)) * uDetail;
  // glyph text on the outer half, close up only
  vec2 g = vec2(a * 1440.0, (x - 0.62) / 0.26);
  vec2 s = floor(vec2(fract(g.x) * 4.0, g.y * 5.0));
  float gl = step(0.0, g.y) * step(g.y, 0.999) * step(s.x, 2.0) * step(0.45, h12(floor(g.x) * vec2(1.0, 7.0) + s)) * step(0.4, h12(vec2(floor(g.x / 9.0), 3.0)));
  gl *= (1.0 - smoothstep(0.25, 0.6, fwidth(g.x))) * uDetail;
  float beads = 0.0;
  for (int i = 0; i < 3; i++) { float b = fract(a - uTime * (0.03 + 0.017 * float(i)) + float(i) * 0.37); beads += exp(-pow(min(b, 1.0 - b) * 260.0, 2.0)); }
  vec3 c = mix(mix(vec3(0.82, 0.88, 1.0), uColor, 0.3), holo(a * 2.0 + uTime * 0.02), 0.15 * uDetail);
  float v = line * 0.5 + maj * 0.4 + mnr * 0.3 + gl * 0.6 + beads * line * 1.6;
  gl_FragColor = vec4(clamp(c * v * band * (0.45 + 0.55 * uDetail), 0.0, 1.5), 1.0);
}`;

export function HoloRing({ size, color, tilt, reduced, detail }: { size: number; color: string; tilt: [number, number, number]; reduced: boolean; detail: () => number }) {
  const inner = size * 1.62, outer = size * 1.74;
  const geo = useMemo(() => new THREE.RingGeometry(inner, outer, 256, 1), [inner, outer]);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uIn: { value: inner }, uOut: { value: outer }, uDetail: { value: 0 }, uColor: { value: new THREE.Color(color) } },
  }), [inner, outer, color]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useFrame(({ clock }) => {
    const d = detail();
    mat.uniforms.uTime.value = reduced ? 7 : clock.elapsedTime;
    mat.uniforms.uDetail.value = Number.isFinite(d) ? Math.min(1, Math.max(0, d)) : 0;
  });
  return <mesh geometry={geo} material={mat} rotation={tilt} />;
}
