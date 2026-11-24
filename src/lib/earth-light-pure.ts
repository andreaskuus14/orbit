// Day, dusk and night for the city close-ups: one set of curves shared by the terrain, the OSM vector ground and the buildings, so the
// terminator moves across all of them together. Input everywhere is s = sin(sun elevation) = dot(up, sunDir).
// Real light: daylight fades through civil twilight (sun +10° … -6°), street lights come on near sunset and are all on by -6°,
// the light goes warm and low around the horizon. The GLSL below is built from the same numbers. Tests: tests/earth-light.test.ts.

const rad = (d: number) => Math.sin((d * Math.PI) / 180);
/** Sun elevations (degrees) where each curve starts and ends. */
export const LIGHT = { dayFrom: -6, dayTo: 10, onFrom: 2, onTo: -6, duskMid: -1, duskWidth: 6 } as const;

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** How much daylight (0 night … 1 day). */
export const dayK = (s: number) => smooth(rad(LIGHT.dayFrom), rad(LIGHT.dayTo), s);
/** How many city lights are on (0 … 1). */
export const lightsK = (s: number) => 1 - smooth(rad(LIGHT.onTo), rad(LIGHT.onFrom), s);
/** Warm low light around sunset / sunrise (0 … 1, peak just below the horizon). */
export const duskK = (s: number) => { const d = (s - rad(LIGHT.duskMid)) / rad(LIGHT.duskWidth); return Math.exp(-d * d); };

const f = (n: number) => n.toFixed(5);
/** The same curves as GLSL functions (dayK, lightsK, duskK) plus the street-light colour (Black Marble's sodium amber). */
export const LIGHT_GLSL = `
float dayK(float s){ return smoothstep(${f(rad(LIGHT.dayFrom))}, ${f(rad(LIGHT.dayTo))}, s); }
float lightsK(float s){ return 1. - smoothstep(${f(rad(LIGHT.onTo))}, ${f(rad(LIGHT.onFrom))}, s); }
float duskK(float s){ float d = (s - (${f(rad(LIGHT.duskMid))})) / ${f(rad(LIGHT.duskWidth))}; return exp(-d * d); }
const vec3 SODIUM = vec3(1., .52, .18);
`;
