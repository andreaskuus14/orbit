// ARCH lawn material (v12): a real CC0 grass PBR set (colour, normal, roughness; Poly Haven grass_ground) laid on the ground in world metres so it
// tiles on any swell. Three things keep it from looking like a tiled photo: every sample is taken twice (a 1.7 m tile and a rotated 11 m tile) and
// the two are blended by slow noise; a soft colour drift over tens of metres (sun-bleached and lush patches); and a faint mown pattern (bands 2.2 m
// wide along the house, fading out with distance). Next to the house the lawn is darkened over the first metre (contact occlusion at the wall foot);
// the house footprint arrives as a uniform.
import * as THREE from "three";

export type Lawn = { d: THREE.Texture; n: THREE.Texture; r: THREE.Texture; fp: { x0: number; x1: number; z0: number; z1: number } | null };

export function lawnMaterial({ d, n, r, fp }: Lawn) {
  const m = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, metalness: 0 });
  m.userData.realism = null; // real textures: no shader noise
  const u = { tLD: { value: d }, tLN: { value: n }, tLR: { value: r }, uFp: { value: fp ? new THREE.Vector4(fp.x0, fp.x1, fp.z0, fp.z1) : new THREE.Vector4(1, -1, 1, -1) } };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vLP; varying vec3 vLN;")
      .replace("#include <project_vertex>", `#include <project_vertex>
      vLP = (modelMatrix * vec4(transformed, 1.0)).xyz; vLN = normalize((vec4(transformedNormal, 0.0) * viewMatrix).xyz);`);
    s.fragmentShader = s.fragmentShader.replace("#include <common>", `#include <common>
varying vec3 vLP; varying vec3 vLN;
uniform sampler2D tLD, tLN, tLR; uniform vec4 uFp;
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
float macroN(vec2 p) { return 0.5 + 0.5 * (sin(p.x * 0.083 + sin(p.y * 0.061) * 2.0) * 0.5 + sin(p.y * 0.097 - p.x * 0.029 + 1.7) * 0.3 + sin((p.x + p.y) * 0.21) * 0.2); }
float blendK() { return smoothstep(0.3, 0.7, macroN(vLP.xz * 1.7 + 11.0)); }
vec2 uvA() { return vLP.xz / 1.7; }
vec2 uvB() { return rot(vLP.xz, 0.9) / 11.0; }
float footD() { vec2 q = vec2(max(max(uFp.x - vLP.x, vLP.x - uFp.y), 0.0), max(max(uFp.z - vLP.z, vLP.z - uFp.w), 0.0)); return length(q); }`)
      .replace("#include <map_fragment>", `{
        vec3 a = texture2D(tLD, uvA()).rgb, b = texture2D(tLD, uvB()).rgb;
        vec3 col = mix(a, b * (dot(a, vec3(0.33)) / max(dot(b, vec3(0.33)), 0.05)), blendK() * 0.55); // second scale, brightness matched to the first
        float mac = macroN(vLP.xz);
        float lum = dot(col, vec3(0.3, 0.59, 0.11));
        col = mix(col, lum * vec3(0.78, 1.5, 0.42), 0.62);                                // the photo is a brown woodland floor: pull it to lawn green, keep its light and shade
        col *= mix(vec3(0.82, 0.95, 0.7), vec3(1.14, 1.12, 0.9), mac);                    // lush and bleached patches
        float far = smoothstep(18.0, 70.0, length(vLP.xz));
        col = mix(col, col * vec3(0.9, 1.0, 0.82), far);
        float band = sin(dot(vLP.xz, vec2(0.0, 1.0)) * 6.2831853 / 4.4) * 0.5 + 0.5;       // mown bands along the house
        col *= 1.0 + (band - 0.5) * 0.24 * (1.0 - smoothstep(12.0, 55.0, length(vLP.xz)));
        float fd = footD(); col *= mix(0.45, 1.0, smoothstep(0.0, 1.3, fd));                // contact occlusion at the wall foot
        diffuseColor.rgb *= col; }`)
      .replace("#include <roughnessmap_fragment>", `float roughnessFactor = roughness * mix(texture2D(tLR, uvA()).g, texture2D(tLR, uvB()).g, 0.4) * 1.0;`)
      .replace("#include <normal_fragment_maps>", `{
        vec3 na = texture2D(tLN, uvA()).xyz * 2.0 - 1.0, nb = texture2D(tLN, uvB()).xyz * 2.0 - 1.0;
        vec3 nm = mix(na, nb, blendK() * 0.4); float k = 1.0 - smoothstep(25.0, 90.0, length(vLP.xz)) * 0.7;
        vec3 wn = normalize(normalize(vLN) + vec3(nm.x, 0.0, nm.y) * 0.9 * k);
        normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz); }`);
  };
  m.customProgramCacheKey = () => "archlawn12";
  return m;
}
