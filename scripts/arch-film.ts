// Scroll film from an ARCH scene: writes a Blender script that renders the fly-through (outside → roof lifts to the plan → inside)
// as numbered frames, dressed with the free asset library. Made for the owner's GPU PC; resumable (stop any time, run again).
//   node --experimental-strip-types scripts/arch-film.ts <scene.json> <assets dir> <out dir> [frames=150] [quality=detail|preview] [WxH=1920x1080]
// then:  blender -b -P <out>/film.py -- <out>/frames     and for the website:  ffmpeg -i <out>/frames/f%03d.png -q:v 3 seq/f%03d.jpg
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { blenderSequence, flyPath, QUALITY, type Quality } from "../src/lib/arch-blender-pure.ts";
import type { Scene } from "../src/lib/arch-pure.ts";

const [sceneFile, assets, out, framesArg = "150", qArg = "detail", sizeArg = "1920x1080"] = process.argv.slice(2);
if (!sceneFile || !assets || !out) { console.error("usage: arch-film.ts <scene.json> <assets dir> <out dir> [frames] [detail|preview] [WxH]"); process.exit(2); }
const scene: Scene = JSON.parse(readFileSync(sceneFile, "utf8"));
const n = Math.max(2, Math.min(600, Number(framesArg) || 150)), quality = (qArg === "preview" ? "preview" : "detail") as Quality;
const [w, h] = sizeArg.split("x").map(Number);
// the room the last beat ends in: the biggest sofa's spot (else the middle)
const sofa = scene.parts.filter((p) => p.kind === "prop" && /sofa/i.test(p.name)).sort((a, b) => b.w * b.d - a.w * a.d)[0];
const room = sofa ? { x: sofa.x + 1.5, z: sofa.z - 1.4 } : undefined;
const py = blenderSequence(scene, { site: { lat: 59.437, lon: 24.7536 }, date: new Date("2026-09-10T16:40:00Z"), quality, size: [w || 1920, h || 1080], assets: path.resolve(assets) }, flyPath(scene, n, room));
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "film.py"), py);
const per = quality === "detail" ? "20-60 s on a recent GPU" : "a few s";
console.log(`wrote ${path.join(out, "film.py")}: ${n} frames at ${w}x${h}, ${QUALITY[quality].samples} samples (${per} per frame)`);
console.log(`render:  blender -b -P ${path.join(out, "film.py")} -- ${path.join(out, "frames")}`);
