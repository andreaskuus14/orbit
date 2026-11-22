// CORE thinking orb: the WebGL2 fragment shader (owner-approved style frames reports/orb/combo-calm.png + combo-think.png).
// A glass sphere with swirling cyan→violet liquid inside (twirled, domain-warped fbm + log-spiral arms, fake refraction),
// a neural web on the inner surface (cellular edges + light points, two layers: the fine one appears when thinking),
// pink sparks riding the threads (a moving crest crossing an edge = a dot travelling along it), a thin luminous rim with a
// cheap in-shader bloom, a top-left highlight, and one faint tilted orbit ring with beads. Transparent outside, premultiplied.
// Numbers come from lib/orb-motion-pure.ts (orbFrame / orbStill).

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
uniform float uCore, uThreads, uSparks, uGlow, uSat, uBeat, uPulse, uRingGlow, uScale, uDetail;
uniform vec2 uLean, uShake;

const float R = ${ORB_R.toFixed(3)};
const float PI = 3.14159265;
const vec3 NAVY = vec3(0.006, 0.014, 0.075);
const vec3 BLUE = vec3(0.10, 0.22, 0.95);
const vec3 VIOLET = vec3(0.42, 0.16, 0.95);
const vec3 CYAN = vec3(0.25, 0.88, 1.0);
const vec3 PINK = vec3(1.0, 0.38, 0.92);

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 h22(vec2 p) { float n = h21(p); return vec2(n, h21(p + n + 17.1)); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = rot(0.6) * p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
// cellular: x = F1, y = F2, z = F3, w = id hash of the nearest cell. Edges: F2-F1 small. Junctions: F3-F1 small.
vec4 cells(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, d3 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(x, y);
    vec2 o = h22(i + g);
    vec2 r = g + 0.1 + 0.8 * o - f;
    float d = dot(r, r);
    if (d < d1) { d3 = d2; d2 = d1; d1 = d; id = o.x; } else if (d < d2) { d3 = d2; d2 = d; } else if (d < d3) { d3 = d; }
  }
  return vec4(sqrt(d1), sqrt(d2), sqrt(d3), id);
}

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - uRes) / uRes.y;
  uv -= uShake * R;
  float px = 2.0 / uRes.y / R;              // one pixel in sphere units
  vec2 q = uv / (R * uScale);
  float r = length(q);
  vec3 col = vec3(0.0);
  float alpha = 0.0;

  // rim colour: cyan top-left -> violet/pink bottom-right (as in the frames)
  float side = clamp(dot(q / max(r, 1e-4), normalize(vec2(0.62, -0.78))) * 0.5 + 0.5, 0.0, 1.0);
  vec3 rimCol = mix(CYAN, mix(VIOLET, PINK, 0.55), smoothstep(0.25, 0.95, side));

  // orbit ring (tilted ellipse), drawn behind the sphere on its far half
  vec2 e = rot(-0.30) * q;
  vec2 ab = vec2(1.33, 0.32);
  vec2 en = e / ab;
  float ef = length(en);
  vec2 eg = (e / (ab * ab)) / max(ef, 1e-4);
  float ed = (ef - 1.0) / max(length(eg), 1e-4);
  float ringLine = exp(-pow(ed / (1.1 * px + 0.004), 2.0));
  float th = atan(en.y, en.x);
  float beads = 0.0;
  for (int k = 0; k < 4; k++) {
    float a = uRing + float(k) * 1.5708 + 0.4 * float(k * k);
    float da = abs(mod(th - a + PI, 2.0 * PI) - PI);
    beads += exp(-pow(da / 0.05, 2.0));
  }
  float ringA = (ringLine * (0.45 + 0.9 * beads) + 0.5 * beads * exp(-pow(ed / 0.025, 2.0))) * uRingGlow;
  float beadGlow = beads * exp(-pow(ed / 0.025, 2.0));
  vec3 ringCol = (mix(CYAN, vec3(0.7, 0.55, 1.0), 0.5 + 0.5 * sin(th + 0.6)) * ringLine * 0.85 + mix(vec3(0.8, 0.95, 1.0), PINK, 0.6) * (ringLine * beads + beadGlow * 0.6)) * uRingGlow;
  bool ringFront = e.y < 0.0;

  if (r < 1.0) {
    float z = sqrt(1.0 - r * r);
    // fake refraction: the glass squeezes the interior toward the rim
    vec2 lq = q * (1.0 + 0.3 * (1.0 - z)) - uLean * (0.6 + 0.4 * z);
    float rr = length(lq);
    float a = atan(lq.y, lq.x);
    vec2 fl = vec2(uFlow, -0.7 * uFlow);
    float n1 = fbm(rot(uSwirl) * lq * 2.0 + fl);
    float n2 = fbm(rot(uSwirl * 1.3) * lq * 3.4 - fl * 1.3 + 2.0 * n1);
    // log-spiral arms (5, so the seam is invisible); tighter and finer when thinking; warped by the noise
    float b = mix(1.0, 1.75, uCore);
    float P = 5.0 * (a - b * log(rr + 0.035)) - uSwirl * 5.0 + 2.2 * (n1 - 0.5) * (1.0 + rr);
    float arm = pow(0.5 + 0.5 * cos(P), mix(0.9, 2.0, uCore));
    float silk = 0.55 + 0.45 * mix(cos(P * 3.0 + 5.0 * n2), cos(P * 6.0 + 5.0 * n2), uCore);   // silky striations (integer multiples: no seam)
    float fade = smoothstep(0.02, 0.18, rr) * (1.0 - 0.35 * smoothstep(0.7, 1.15, rr));
    float body = arm * silk * fade * (0.55 + 1.3 * exp(-rr * 2.2)) + 0.08 * n2 * fade;
    // colour: cyan near the middle -> blue -> violet outside; pink catching the arms low-right
    float hueT = smoothstep(0.2, 1.1, rr + 0.3 * (n1 - 0.5));
    vec3 lc = mix(CYAN, BLUE, smoothstep(0.0, 0.5, hueT));
    lc = mix(lc, VIOLET, smoothstep(0.45, 1.0, hueT) * (1.0 - 0.45 * uCore));
    lc = mix(lc, PINK, 0.45 * smoothstep(0.5, 1.0, side) * smoothstep(0.45, 0.95, rr) * smoothstep(0.5, 0.9, silk));
    vec3 inside = NAVY * (0.6 + 0.8 * n2) + lc * body * 1.3;
    // bright core: tight and white when thinking
    float coreK = mix(10.0, 26.0, uCore);
    inside += mix(CYAN, vec3(1.0), 0.35 + 0.5 * uCore) * (exp(-rr * coreK) * mix(0.9, 3.2, uCore) + exp(-rr * 4.0) * mix(0.15, 0.5, uCore));

    // neural web on the inner surface: lon/lat of the sphere normal, slowly turning, domain-warped so threads curve
    vec3 nrm = vec3(q, z);
    vec2 sc = vec2(atan(nrm.x, nrm.z) + uFlow * 0.3, asin(clamp(nrm.y, -1.0, 1.0)) * 1.1);
    float dens = 5.6 * mix(0.7, 1.0, uDetail);
    vec2 p1 = sc * dens;
    p1 += 0.45 * vec2(vnoise(p1 * 0.9 + 3.0), vnoise(p1 * 0.9 + 9.0)) - 0.22;
    vec4 c1 = cells(p1);
    float g1 = c1.y - c1.x;
    float line1 = 1.0 - smoothstep(0.0, fwidth(g1) * 1.1 + 0.012, g1);
    float junc1 = exp(-pow((c1.z - c1.x) / 0.06, 2.0)) * 1.5 + 0.3 * exp(-pow((c1.z - c1.x) / 0.16, 2.0));
    // fine layer: fades in with density (the web "densifies" without rescaling)
    float fineA = mix(0.3, 1.0, smoothstep(0.2, 0.95, uThreads)) * uDetail;
    vec2 p2 = p1 * 2.4 + 7.3;
    vec4 c2 = cells(p2);
    float g2 = c2.y - c2.x;
    float line2 = 1.0 - smoothstep(0.0, fwidth(g2) * 1.1 + 0.02, g2);
    float junc2 = exp(-pow((c2.z - c2.x) / 0.07, 2.0)) * 1.6;
    float limb = 0.5 + 0.5 * (1.0 - z); // threads read brighter toward the rim, through more glass
    float web = line1 * mix(0.22, 0.42, uThreads) * (0.55 + 0.9 * arm) + line2 * 0.22 * fineA + exp(-g1 * 18.0) * 0.07 * uThreads;
    // writing: each text chunk sends a ring of light from the core along the web
    web *= 1.0 + 2.0 * uBeat * exp(-pow((r - (1.0 - uBeat)) / 0.18, 2.0));
    float nodes = junc1 * mix(0.5, 1.0, uThreads) + junc2 * 0.55 * fineA;
    vec3 webCol = vec3(0.2, 0.55, 1.0);
    inside += webCol * web * limb * 0.85;
    // light points at the junctions; some glow pink, more when thinking
    float pinkNode = step(1.0 - uSparks * (0.25 + 0.6 * arm), fract(c1.w * 13.7));
    inside += mix(vec3(0.3, 0.75, 1.0), PINK, pinkNode) * nodes * (0.8 + 0.8 * pinkNode * uSparks) * limb;
    inside += PINK * pinkNode * uSparks * exp(-pow((c1.z - c1.x) / 0.14, 2.0)) * 0.55; // soft pink glow round lit junctions
    // sparks: a moving crest crossing an edge = a dot travelling along that thread; only some cells carry one
    float crest = pow(0.5 + 0.5 * sin(dot(p1, vec2(1.7, 1.1)) * 2.4 + c1.w * 6.283 - uSpark * 8.0), 30.0);
    float carry = step(1.0 - uSparks, fract(c1.w * 7.31 + 0.13));
    float spark = carry * crest * (line1 + 0.6 * exp(-g1 * 12.0));
    inside += PINK * spark * 2.2 + vec3(1.0, 0.85, 1.0) * spark * junc1 * 1.5;

    // tool: a bright pulse travels from the core out to the rim (and leaves, below)
    if (uPulse >= 0.0) {
      float pr = uPulse * 1.45;
      float pw = exp(-pow((r - pr) / 0.05, 2.0)) * (1.0 - uPulse);
      inside += mix(vec3(1.0), CYAN, 0.5) * pw * 1.2;
    }
    // glass: fresnel glow and a glossy crescent highlight on the upper left
    float fres = pow(1.0 - z, 3.0);
    inside += mix(vec3(0.15, 0.5, 1.0), rimCol, 0.6) * fres * (0.25 + 0.6 * uGlow) + rimCol * exp(-(1.0 - r) * 26.0) * (0.3 + 0.45 * uGlow);
    // glossy highlight: a short bright arc just inside the rim, upper left (the glass catching light)
    vec2 dir = q / max(r, 1e-4);
    float arcA = pow(max(0.0, dot(dir, normalize(vec2(-0.5, 0.87)))), 10.0);
    float band = smoothstep(0.83, 0.88, r) * (1.0 - smoothstep(0.93, 0.965, r));
    inside += vec3(0.85, 0.94, 1.0) * band * arcA * 0.55 + vec3(0.6, 0.85, 1.0) * arcA * smoothstep(0.6, 0.95, r) * 0.08;
    col = inside;
    alpha = 1.0;
    if (ringFront) { col += ringCol; }
  } else {
    col += ringCol;
    alpha = max(alpha, ringA);
  }

  // rim line + bloom (in and out); pulse leaving past the rim
  float rimLine = exp(-pow((r - 1.0) / (1.8 * px + 0.009), 2.0));
  float bloom = r > 1.0 ? exp(-(r - 1.0) * mix(13.0, 6.5, uGlow)) : 0.0;
  vec3 glowC = mix(rimCol, vec3(0.9, 0.97, 1.0), 0.25 * rimLine) * rimLine * (0.9 + 0.6 * uGlow) + mix(vec3(0.15, 0.45, 1.0), rimCol, 0.6) * bloom * 0.95 * uGlow;
  float halo = r > 1.0 ? exp(-(r - 1.0) * 2.2) * 0.12 * uGlow : 0.0;
  glowC += mix(BLUE, VIOLET, side) * halo * 0.6;
  if (uPulse >= 0.0 && r >= 1.0) {
    float pr = uPulse * 1.45;
    glowC += CYAN * exp(-pow((r - pr) / 0.06, 2.0)) * (1.0 - uPulse) * 1.2;
  }
  col += glowC;
  alpha = max(alpha, clamp(max(glowC.r, max(glowC.g, glowC.b)), 0.0, 1.0));

  // saturation (error drains colour), tone map, soft canvas edge
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSat);
  col *= 1.25; // exposure
  float mx = max(col.r, max(col.g, col.b));
  col *= (1.0 - exp(-mx * 1.3)) / max(mx, 1e-4); // hue-preserving tone map (bright stays coloured, not grey)
  col = mix(col, vec3(1.0), 0.6 * smoothstep(1.6, 4.0, mx)); // only the hottest core whitens
  float edge = smoothstep(1.0, 0.86, length(uv));
  col *= edge;
  alpha = max(alpha * edge, max(col.r, max(col.g, col.b))); // premultiplied: colour never above alpha
  fragColor = vec4(col, alpha);
}`;
