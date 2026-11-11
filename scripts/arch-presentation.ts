// Generate aligned renders for ORBIT's existing scroll sequence sections.
// Render with: blender -b -P <out>/wireframe.py -- <out>/wireframe
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { archPresentation, presentationModes } from "../src/lib/arch-presentation-pure.ts";
import type { Scene } from "../src/lib/arch-pure.ts";

const [file, out, count = "48", size = "1280x720", assets] = process.argv.slice(2);
const frames = Number(count);
const [width, height] = size.split("x").map(Number);
if (!file || !out || !Number.isInteger(frames) || frames < 2 || frames > 240 ||
    !/^\d+x\d+$/.test(size) || ![width, height].every((n) => n >= 64 && n <= 4096)) {
  console.error("Usage: arch-presentation.ts <scene.json> <output dir> [frames 2–240] [widthxheight] [asset dir]");
  process.exit(2);
}
const scene: Scene = JSON.parse(readFileSync(file, "utf8"));
const options = { site: { lat: 59.437, lon: 24.7536 }, date: new Date("2026-09-10T16:40:00Z"), quality: "preview" as const,
  size: [width, height] as [number, number], ...(assets ? { assets: path.resolve(assets) } : {}) };
const scripts = presentationModes.map((mode) => [mode, archPresentation(scene, options, frames, mode)] as const);
mkdirSync(out, { recursive: true });
for (const [mode, script] of scripts) writeFileSync(path.join(out, `${mode}.py`), script);
const sequences = presentationModes.map((mode) => ({ mode, path: `${mode}/f%03d.png`, count: frames, width, height, alt: `ARCH ${mode} view` }));
writeFileSync(path.join(out, "sequences.json"), JSON.stringify(sequences, null, 2) + "\n");
console.log(`Generated ${scripts.length} Blender scripts and sequences.json in ${out}.`);
