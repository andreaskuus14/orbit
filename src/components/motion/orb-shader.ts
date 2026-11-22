// CORE thinking orb: the WebGL2 fragment shader (owner-approved style frames reports/orb/combo-calm.png + combo-think.png).
// A glass sphere with silky folded cyan→violet ribbons inside (log-spiral arms warped by fbm, with a thin-film rainbow sheen on
// the fold slopes), a neural web on the inner surface (a "plexus": drifting nodes joined by thin curved filaments, two layers,
// the fine one fills in when thinking, plus ridged-noise fibres), pink nodes with soft bloom, sparks that travel along the
// filaments, a crisp glossy crescent top-left, a thin bright rim with a short bloom, and a thin tilted orbit ring with beads.
// Transparent outside, premultiplied. uTier (0 small … 2 full) trims noise octaves and web layers (orbQuality in
// lib/orb-motion-pure.ts). Numbers come from lib/orb-motion-pure.ts (orbFrame / orbStill).

export const ORB_VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

/** Sphere radius in canvas units (canvas spans -1…1): the canvas is 1/R times the orb, leaving room for ring + bloom. */
export const ORB_R = 0.6;

export const ORB_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uRes;
uniform float uSwirl, uFlow, uSpark, uRing;
uniform float uCore, uThreads, uSparks, uGlow, uSat, uBeat, uPulse, uRingGlow, uScale, uTier;
uniform vec2 uLean, uShake;

const float R = ${ORB_R.toFixed(3)};
const float PI = 3.14159265;
const vec3 NAVY = vec3(0.003, 0.008, 0.045);
const vec3 DEEP = vec3(0.015, 0.035, 0.17);
const vec3 BLUE = vec3(0.07, 0.32, 1.0);
const vec3 VIOLET = vec3(0.50, 0.17, 1.0);
const vec3 CYAN = vec3(0.28, 0.93, 1.0);
const vec3 PINK = vec3(1.0, 0.28, 0.86);
const vec3 ICE = vec3(0.86, 0.97, 1.0);

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 h22(vec2 p) { float n = h21(p); return vec2(n, h21(p + n + 17.1)); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 4; i++) { if (i >= oct) break; s += a * vnoise(p); n += a; p = rot(0.6) * p * 2.03 + 11.7; a *= 0.5; }
  return s / n;
}
// ridged multi-octave noise: thin branching fibres (each octave adds finer side branches)
float fibres(vec2 p, int oct) {
  float s = 0.0, a = 1.0;
  for (int i = 0; i < 3; i++) { if (i >= oct) break; float v = 1.0 - abs(2.0 * vnoise(p) - 1.0); s += a * pow(v, 14.0); p = rot(0.9) * p * 2.17 + 5.3; a *= 0.55; }
  return s;
}

// ---- neural web: a plexus of drifting nodes, each joined to its neighbours by thin filaments ----
struct Web { float line; float node; float pink; float spark; };
vec2 nodeAt(vec2 cell, float t) { vec2 n = h22(cell); return 0.5 + 0.36 * sin(n * 6.283 + t * (0.35 + 0.5 * n.yx)); }
void link(inout Web o, vec2 f, vec2 a, vec2 b, vec2 ia, vec2 ib, float w, float st, float share) {
  vec2 ba = b - a;
  float L = length(ba);
  float fade = smoothstep(1.5, 0.8, L); // long links fade out: a web, not a grid
  if (fade <= 0.0) return;
  vec2 pa = f - a;
  float h = clamp(dot(pa, ba) / (L * L), 0.0, 1.0);
  float d = length(pa - ba * h);
  vec2 key = ia + ib; // same key from either end
  float hs = h21(key * 1.37 + 5.1);
  float core = exp(-d * d / (w * w));
  o.line += (core + 0.12 * exp(-d / (w * 5.0))) * fade * (0.45 + 0.55 * hs);
  // a spark rides this filament: a bright head with a short tail, always moving the same way along it
  if (h21(key + 8.3) < share) {
    float sgn = dot(ia - ib, vec2(1.0, 57.0)) > 0.0 ? -1.0 : 1.0;
    float s = fract(st * (0.55 + 0.9 * h21(key + 2.2)) + hs * 7.0);
    s = sgn > 0.0 ? s : 1.0 - s;
    float along = (h - s) * L;
    float head = exp(-(along * along + d * d) / (w * w * 10.0)) * 1.3;
    float behind = -sgn * along;
    float tail = behind > 0.0 ? core * exp(-behind / 0.22) * 0.5 : 0.0;
    o.spark += (head + tail) * fade * smoothstep(0.0, 0.15, s) * smoothstep(1.0, 0.85, s);
  }
}
Web plexus(vec2 p, float w, float t, float st, float share, float pinkShare, float nodeR) {
  vec2 id = floor(p), f = p - id;
  vec2 P[9], I[9];
  Web o = Web(0.0, 0.0, 0.0, 0.0);
  for (int k = 0; k < 9; k++) {
    vec2 g = vec2(float(k % 3 - 1), float(k / 3 - 1));
    I[k] = id + g; P[k] = g + nodeAt(I[k], t);
    float d = length(f - P[k]);
    float big = step(1.0 - pinkShare, h21(I[k] + 3.7));
    float rr = min(nodeR * (0.55 + 0.9 * h21(I[k] + 9.1)) * (1.0 + 2.0 * big), 0.14);
    float g2 = exp(-d * d / (rr * rr));
    o.node += g2 * (1.0 - big);
    // pink nodes: bigger, with a soft bloom that ends inside the 3x3 cells we look at (no cut edges at cell borders)
    o.pink += big * (g2 * 2.2 + 0.55 * exp(-d / min(rr * 2.6, 0.22)) * smoothstep(0.95, 0.45, d));
  }
  for (int k = 0; k < 9; k++) if (k != 4) link(o, f, P[4], P[k], I[4], I[k], w, st, share);
  link(o, f, P[1], P[3], I[1], I[3], w, st, share); link(o, f, P[1], P[5], I[1], I[5], w, st, share);
  link(o, f, P[7], P[3], I[7], I[3], w, st, share); link(o, f, P[7], P[5], I[7], I[5], w, st, share);
  return o;
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - uRes) / uRes.y;
  uv -= uShake * R;
  float px = 2.0 / uRes.y / R;              // one pixel in sphere units
  vec2 q = uv / (R * uScale);
  float r = length(q);
  int tier = int(uTier + 0.5);
  float rpx = 0.5 * uRes.y * R * uScale; // sphere radius in device pixels
  float small = smoothstep(110.0, 40.0, rpx); // 1 on tiny orbs: calmer pink, fewer blooms
  vec3 col = vec3(0.0);
  float alpha = 0.0;

  // rim colour: ice-cyan top-left -> violet -> pink bottom-right (as in the frames)
  float side = clamp(dot(q / max(r, 1e-4), normalize(vec2(0.62, -0.78))) * 0.5 + 0.5, 0.0, 1.0);
  vec3 rimCol = mix(mix(ICE, CYAN, 0.55), mix(VIOLET, PINK, 0.6), smoothstep(0.3, 0.95, side));

  // orbit ring: a thin, bright tilted ellipse with small beads; the far half hides behind the sphere
  vec2 e = rot(-0.30) * q;
  vec2 ab = vec2(1.36, 0.30);
  vec2 en = e / ab;
  float ef = length(en);
  vec2 eg = (e / (ab * ab)) / max(ef, 1e-4);
  float ed = (ef - 1.0) / max(length(eg), 1e-4);
  float lw = 0.75 * px + 0.0018;
  float ringLine = exp(-ed * ed / (lw * lw)) + 0.18 * exp(-abs(ed) / 0.018);
  float beads = 0.0;
  for (int k = 0; k < 5; k++) {
    float ba = uRing + float(k) * 1.2566 + 0.35 * float(k * k);
    float bd = length(e - ab * vec2(cos(ba), sin(ba)));
    float br = 0.014 + px;
    beads += exp(-bd * bd / (br * br)) * 1.6 + exp(-bd / 0.03) * 0.35;
  }
  float ringT = smoothstep(-0.7, 0.9, e.x / ab.x);
  vec3 ringCol = 1.6 * (mix(mix(CYAN, ICE, 0.4), mix(VIOLET, PINK, 0.5), ringT) * ringLine * 1.5 + mix(ICE, PINK, ringT * 0.8) * beads * 1.3) * uRingGlow;
  float ringA = clamp(max(ringCol.r, max(ringCol.g, ringCol.b)), 0.0, 1.0);
  bool ringFront = e.y < 0.0;

  if (r < 1.0) {
    float z = sqrt(1.0 - r * r);
    // ---- liquid: silky folded ribbons ----
    vec2 lq = q * (1.0 + 0.28 * (1.0 - z)) - uLean * (0.6 + 0.4 * z); // fake refraction: squeezed toward the rim
    float rr = length(lq);
    float a = atan(lq.y, lq.x);
    vec2 fl = vec2(uFlow, -0.7 * uFlow);
    int oct = 2 + tier;
    float n1 = fbm(rot(uSwirl) * lq * 1.8 + fl, oct);
    float n2 = fbm(rot(uSwirl * 1.3) * lq * 3.2 - fl * 1.3 + 2.0 * n1, oct);
    // 5 log-spiral arms (integer: no seam), tighter when thinking, warped by the noise so they fold
    float b = mix(0.9, 1.65, uCore);
    float P = 5.0 * (a - b * log(rr + 0.04)) - uSwirl * 5.0 + 2.6 * (n1 - 0.5) * (0.6 + rr);
    float x = 0.5 + 0.5 * cos(P);
    float x2 = 0.5 + 0.5 * cos(2.0 * P + 1.5 * (n2 - 0.5));
    // thinking: 5 wide ribbons become 10 thin, tight arms (both integer counts, so no seam while blending)
    float ribbon = mix(smoothstep(0.22, 1.0, x), smoothstep(0.5, 1.0, x2) * (0.75 + 0.25 * x), smoothstep(0.35, 0.95, uCore));
    float strands = 1.0;
    float silk = 0.62 + 0.38 * cos(P * 4.0 + 6.0 * n2);                                              // folds running along the ribbon
    float fade = smoothstep(0.0, 0.15, rr) * (1.0 - 0.25 * smoothstep(0.75, 1.1, rr));
    float body = ribbon * strands * silk * fade;
    // colour: bright cyan at the core -> blue -> violet outside, pink catching the outer tips (low right)
    float tc = smoothstep(0.05, 1.05, rr + 0.25 * (n1 - 0.5));
    vec3 lc = mix(CYAN, BLUE, smoothstep(0.12, 0.55, tc));
    lc = mix(lc, VIOLET, smoothstep(0.45, 0.9, tc) * (1.0 - 0.35 * uCore));
    lc = mix(lc, PINK, 0.5 * (1.0 - 0.6 * uCore) * (1.0 - 0.55 * small) * smoothstep(0.7, 1.0, tc) * smoothstep(0.35, 0.9, side + 0.3 * (n2 - 0.5)));
    vec3 inside = mix(NAVY, DEEP, smoothstep(0.25, 0.75, n2)) * (0.8 + 0.7 * (1.0 - z));
    inside += lc * body * (0.55 + 1.7 * exp(-rr * 2.4)) * 1.25;
    // thin-film sheen on the folds: the fold normal tilts with the ribbon's slope (|sin P|); film thickness drifts with the flow
    if (tier > 0) {
      float slope = abs(sin(P)) * 2.6;
      float cosT = inversesqrt(1.0 + slope * slope);
      float thick = 0.45 + 0.25 * cos(P * 3.0 + 5.0 * n2) + 0.5 * rr + 0.35 * n1;
      vec3 iri = 0.5 + 0.5 * cos(6.283 * (2.0 * thick * cosT + vec3(0.0, 0.33, 0.67)));
      float foldM = (1.0 - cosT) * smoothstep(0.08, 0.5, x) * (1.0 - smoothstep(0.9, 1.0, x)) * fade * smoothstep(0.2, 0.6, rr);
      iri = iri * iri * vec3(1.0, 0.55, 1.0); // keep the sheen in the orb's palette (pink / violet / cyan), little green
      inside += iri * foldM * mix(0.2, 0.12, uCore);
    }
    // bright core: tight and white-hot when thinking
    inside += mix(CYAN, ICE, 0.3 + 0.5 * uCore) * (exp(-rr * mix(8.0, 20.0, uCore)) * mix(1.3, 3.2, uCore) + exp(-rr * 3.2) * mix(0.3, 0.5, uCore));

    // ---- neural web on the inner surface (lon/lat of the normal, slowly turning, domain-warped so filaments curve) ----
    vec3 nrm = vec3(q, z);
    vec2 sc = vec2(atan(nrm.x, nrm.z) + uFlow * 0.25, asin(clamp(nrm.y, -1.0, 1.0)) * 1.05);
    // density follows the pixels: a coarse cell stays >= ~13 px across at the centre, so small orbs get fewer, cleaner threads
    float dens = clamp(2.0 * rpx / (13.0 * PI), 2.0, 5.0);
    float ppc2 = 2.0 * rpx / (PI * dens * 2.3); // pixels per fine cell
    vec2 p1 = sc * dens;
    p1 += 0.6 * vec2(vnoise(p1 * 0.6 + 3.0), vnoise(p1 * 0.6 + 9.0)) - 0.3;
    p1 += 0.32 * vec2(vnoise(p1 * 1.7 + 1.0), vnoise(p1 * 1.7 + 5.0)) - 0.16; // second, finer warp: filaments bend within a link
    float fw1 = max(length(fwidth(p1)), 1e-4);
    float sparkT = uSpark * 1.6;
    float sparkShare = 0.04 + 0.16 * uSparks;
    Web w1 = plexus(p1, max(fw1 * 0.75, 0.014), uFlow * 2.0, sparkT, sparkShare, mix(0.06, 0.09, uSparks), max(fw1 * 1.4, 0.035));
    float limb = (0.75 + 0.35 * (1.0 - z)) * smoothstep(0.0, 0.22, z); // brighter toward the rim, but clean at the very edge    // threads read brighter toward the rim, through more glass
    float under = 1.0 - 0.45 * clamp(body, 0.0, 1.0); // dimmer under the bright ribbons
    float web = w1.line * mix(0.3, 0.55, uThreads);
    float nodes = w1.node * mix(0.6, 1.0, uThreads);
    float pink = w1.pink * (0.7 + 0.6 * uSparks) * (0.35 + 0.9 * smoothstep(0.0, 0.8, ribbon)); // pink glows strongest along the arms
    float spark = w1.spark;
    if (tier == 2 && ppc2 > 5.0) { // fine layer: always faintly there, fills in when thinking (the web "densifies" without rescaling)
      float fineA = mix(0.35, 1.0, smoothstep(0.25, 0.95, uThreads)) * smoothstep(0.05, 0.4, z) * smoothstep(5.0, 9.0, ppc2); // thins out at the limb, where lon/lat crowds
      vec2 p2 = p1 * 2.3 + 7.3;
      float fw2 = max(length(fwidth(p2)), 1e-4);
      Web w2 = plexus(p2, max(fw2 * 0.7, 0.02), uFlow * 2.6 + 3.0, sparkT * 1.3, sparkShare * 0.35, mix(0.0, 0.03, uSparks), max(fw2 * 1.1, 0.05));
      web += w2.line * 0.45 * fineA;
      nodes += w2.node * 0.7 * fineA;
      pink += w2.pink * 0.6 * fineA;
      spark += w2.spark * 0.7 * fineA;
    }
    if (tier > 0) web += fibres(p1 * 1.7 + 1.3, tier + 1) * 0.07 * mix(0.6, 1.0, uThreads); // fine branching fibres between
    // writing: each text chunk sends a ring of light from the core along the web
    float wave = 1.0 + 2.2 * uBeat * exp(-pow((r - (1.0 - uBeat)) / 0.18, 2.0));
    inside += vec3(0.22, 0.58, 1.0) * web * limb * under * wave;
    inside += mix(vec3(0.45, 0.85, 1.0), ICE, 0.4) * nodes * limb * 0.9 * wave;
    pink *= 1.0 - 0.6 * small;
    inside += PINK * pink * limb * 1.4 + ICE * smoothstep(1.0, 2.2, pink) * 0.8; // hot white centre
    inside += (PINK * 1.5 + ICE * 0.6 * smoothstep(0.5, 1.0, spark)) * spark * (0.6 + 0.6 * uSparks) * smoothstep(0.0, 0.3, z);

    // tool: a bright pulse travels from the core out to the rim (and leaves, below)
    if (uPulse >= 0.0) {
      float pr = uPulse * 1.45;
      inside += mix(ICE, CYAN, 0.5) * exp(-pow((r - pr) / 0.05, 2.0)) * (1.0 - uPulse) * 1.2;
    }
    // ---- glass: fresnel, inner rim light, a crisp glossy crescent top-left ----
    float fres = pow(1.0 - z, 2.5);
    inside += mix(BLUE, rimCol, 0.6) * fres * (0.25 + 0.5 * uGlow) + rimCol * exp(-(1.0 - r) * 30.0) * (0.45 + 0.5 * uGlow);
    float aa = 1.5 * px;
    float cres = (1.0 - smoothstep(0.955 - aa, 0.955, r)) * smoothstep(0.9, 0.9 + aa, length(q - vec2(0.055, -0.075)));
    float am = smoothstep(0.3, 0.85, dot(q / max(r, 1e-4), normalize(vec2(-0.55, 0.83))));
    float hl = cres * am;
    inside = mix(inside, inside * 0.85 + ICE * (0.3 + 0.55 * smoothstep(0.84, 0.95, r)), hl);
    col = inside;
    alpha = 1.0;
    if (ringFront) col += ringCol;
  } else {
    col += ringCol;
    alpha = ringA;
  }

  // rim line + a short bloom; a faint wide halo; the tool pulse leaving past the rim
  float rimLine = exp(-pow((r - 1.0) / (1.2 * px + 0.006), 2.0));
  float o = max(r - 1.0, 0.0);
  float bloom = r > 1.0 ? exp(-o * mix(20.0, 11.0, uGlow)) * 0.8 : 0.0;
  float halo = r > 1.0 ? exp(-o * 5.5) * 0.13 : 0.0;
  vec3 glowC = mix(rimCol, ICE, 0.3) * rimLine * (1.1 + 0.6 * uGlow) + rimCol * bloom * uGlow + mix(BLUE, VIOLET, side) * halo * uGlow;
  if (uPulse >= 0.0 && r >= 1.0) glowC += CYAN * exp(-pow((r - uPulse * 1.45) / 0.06, 2.0)) * (1.0 - uPulse) * 1.2;
  col += glowC;
  alpha = max(alpha, clamp(max(glowC.r, max(glowC.g, glowC.b)), 0.0, 1.0));

  // saturation (error drains colour; a small boost otherwise), hue-preserving tone map, soft canvas edge
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = max(mix(vec3(l), col, uSat * 1.12), 0.0);
  col *= 1.2; // exposure
  float mx = max(col.r, max(col.g, col.b));
  col *= (1.0 - exp(-mx * 1.35)) / max(mx, 1e-4); // bright stays coloured, not grey
  col = mix(col, vec3(1.0), 0.55 * smoothstep(1.8, 4.5, mx)); // only the hottest core whitens
  float edge = smoothstep(1.0, 0.88, length(uv));
  col *= edge;
  alpha = max(alpha * edge, max(col.r, max(col.g, col.b))); // premultiplied: colour never above alpha
  fragColor = vec4(col, alpha);
}`;
