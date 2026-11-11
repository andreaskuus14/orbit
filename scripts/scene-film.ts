// W03 three-scene film, fully local (fake voice, no network, no credits): builds the fixture manifest in both formats, applies the
// scene-2 edit fixture, rebuilds, and reports which scenes were rendered vs reused, their hashes, and the export preflight.
//   node --experimental-strip-types scripts/scene-film.ts <out dir> [--formats vertical,landscape]
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { buildFilm, probe } from "../src/lib/clips/scene-render.ts";
import { cues, dirtyScenes, editScene, manifestProblems, preflight, sceneHashes, srt, starts, type Format, type Manifest } from "../src/lib/clips/scene-manifest-pure.ts";

const out = path.resolve(process.argv[2] ?? "scene-film");
const fi = process.argv.indexOf("--formats");
const formats = (fi > 0 ? process.argv[fi + 1] : "vertical,landscape").split(",") as Format[];
const ff = process.env.ORBIT_FFMPEG || "ffmpeg", fp = process.env.ORBIT_FFPROBE || "ffprobe";
const fx = (f: string) => JSON.parse(readFileSync(path.join(import.meta.dirname, "../tests/fixtures", f), "utf8"));
const before: Manifest = fx("film-bridge-gaps.json"), edit = fx("film-bridge-gaps-s2-edit.json");
const after = editScene(before, edit.scene, edit.patch);
for (const m of [before, after]) { const p = manifestProblems(m); if (p.length) throw new Error(p.join("; ")); }
const cache = path.join(out, "cache");
mkdirSync(out, { recursive: true });

const report: Record<string, unknown> = {};
for (const format of formats) {
  const runs = [];
  for (const [label, m] of [["before", before], ["after", after]] as const) {
    const dir = path.join(out, label);
    const film = await buildFilm(m, format, { ffmpeg: ff, cache, out: dir });
    writeFileSync(path.join(dir, `film-${format}.srt`), srt(cues(m, format)));
    const missing = [...film.scenes.map((s) => s.file), film.final.file].filter((f) => !existsSync(f));
    const pf = preflight(m, format, await probe(film.final.file, ff, fp), missing);
    // Frame grabs: the key pose of each scene (a third in), from the final file.
    starts(m).forEach((st, i) => spawnSync(ff, ["-y", "-loglevel", "error", "-i", film.final.file, "-vf", `select=eq(n\\,${st + Math.round(m.scenes[i].frames / 3)})`, "-frames:v", "1", path.join(dir, `grab-${format}-${m.scenes[i].id}.png`)]));
    runs.push({ label, film, preflight: pf });
    console.log(`\n${format} ${label}: ${film.final.reused ? "final reused" : "final rendered"} ${film.final.outputHash.slice(0, 12)} (${film.final.ms} ms)`);
    for (const s of film.scenes) console.log(`  ${s.id}@v${s.version} ${s.reused ? "reused  " : "rendered"} in ${s.inputHash.slice(0, 12)} out ${s.outputHash.slice(0, 12)} (${s.ms} ms)`);
    for (const c of pf.checks) console.log(`  ${c.ok ? "PASS" : "FAIL"} ${c.id}: ${c.detail}`);
  }
  const dirty = dirtyScenes(sceneHashes(before, format), sceneHashes(after, format));
  const [b, a] = runs.map((r) => r.film);
  const same = b.scenes.filter((s, i) => s.outputHash === a.scenes[i].outputHash).map((s) => s.id);
  console.log(`  dirty after edit: ${dirty.join(", ")}; output unchanged: ${same.join(", ")}; re-rendered: ${a.scenes.filter((s) => !s.reused).map((s) => s.id).join(", ")} + final`);
  report[format] = { dirty, unchangedOutputs: same, runs };
}
writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
