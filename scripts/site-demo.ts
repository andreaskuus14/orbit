// W02 demo: one finished website from a synthetic brief and fixture images, through the real workspace path, in a throwaway data
// dir (no Supabase, no generation, nothing sent). Build v1 → ws_check → copy edit v2 (assets byte-identical) → .zip export →
// unzip → QA the unzipped folder offline at 4 widths → QA packet into the export → broken page as the failing control.
// Run: node --no-warnings --experimental-strip-types scripts/site-demo.ts [out-dir] [--art]   (--art: add the art-director review)
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const out = path.resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? path.join(os.tmpdir(), "orbit-site-demo"));
const fx = path.resolve("tests/fixtures/site-w02");
process.env.ORBIT_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "orbit-w02-"));
const ws = await import("../src/lib/workspace.ts");
const { buildSite, editSiteCopy } = await import("../src/lib/site-brief.ts");
const { qaExport } = await import("../src/lib/site-qa.ts");
const { qaMarkdown } = await import("../src/lib/site-qa-pure.ts");
const { launch } = await import("../src/lib/workspace-check.ts");
const fail: (m: string) => never = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex").slice(0, 16);

const uid = "demo-owner", slug = "holm-light";
await mkdir(out, { recursive: true });
const made = await ws.createWorkspace(uid, slug);
if ("error" in made) fail(made.error);

// Fixture images: the SVG art rasterised to JPEG (stand-ins for the owner's VAULT photos), written like any workspace image.
const browser = await launch();
if (!browser) fail("no headless Chromium");
for (const [name, w, h] of [["hero", 1600, 1600], ["lantern", 1200, 1500]] as const) {
  const p = await browser!.newPage({ viewport: { width: w, height: h } });
  await p.setContent(`<style>html,body{margin:0}</style>${await readFile(path.join(fx, `${name}.svg`), "utf8")}`);
  const jpg = await p.screenshot({ type: "jpeg", quality: 82 });
  const r = await ws.writeWsFile(uid, slug, `assets/${name}.jpg`, new Uint8Array(jpg));
  if ("error" in r) fail(r.error);
  console.log(`asset assets/${name}.jpg ${Math.round(jpg.length / 1024)} KB`);
}
await browser!.close();
const assetHashes = async () => Promise.all(["assets/hero.jpg", "assets/lantern.jpg"].map(async (p) => sha((await ws.readWsFile(uid, slug, p))!.bytes)));

// v1 from the detailed brief.
const v1 = await buildSite(uid, slug, JSON.parse(await readFile(path.join(fx, "brief-detailed.json"), "utf8")));
if ("errors" in v1) fail(v1.errors.join("; "));
console.log(`built v${v1.brief.version}: sections ${v1.brief.sections.map((s) => s.id).join(", ")}; missing essentials: ${v1.missing.join(", ") || "none"}`);
const { checkSite } = await import("../src/lib/workspace-check.ts");
console.log(`ws_check v1: ${(await checkSite(uid, slug))?.line}`);
await writeFile(path.join(out, "index-v1.html"), (await ws.readWsFile(uid, slug, "index.html"))!.text);

// v2: copy edits only.
const before = await assetHashes(), css = (await ws.readWsFile(uid, slug, "css/style.css"))!.text;
const v2 = await editSiteCopy(uid, slug, [
  { section: "hero", field: "heading", value: "Steady light for the dark half of the year." },
  { section: "waitlist", field: "cta.0.label", value: "Reserve my number" },
]);
if ("errors" in v2) fail(v2.errors.join("; "));
const after = await assetHashes();
if (before.join() !== after.join() || css !== (await ws.readWsFile(uid, slug, "css/style.css"))!.text) fail("copy edit changed an asset or the CSS");
console.log(`edited → v${v2.brief.version}: ${v2.changed.join(", ")}; assets unchanged (${after.join(", ")})`);
await writeFile(path.join(out, "index-v2.html"), (await ws.readWsFile(uid, slug, "index.html"))!.text);
console.log(`ws_check v2: ${(await checkSite(uid, slug))?.line}`);

// Reversible picture swap (in memory: the export below stays v2): hero → lantern, then undo gives the same page back.
{
  const { renderSite, swapImage, undoImage } = await import("../src/lib/site-brief-pure.ts");
  const sw = swapImage(v2.brief, "hero", "lantern");
  if ("error" in sw) fail(sw.error);
  const un = undoImage(sw.brief);
  if ("error" in un) fail(un.error);
  const page = (b: typeof v2.brief) => renderSite({ ...b, version: 0 })["index.html"];
  if (page(un.brief) !== page(v2.brief)) fail("undo didn't restore the page");
  console.log(`image swap → v${sw.brief.version} (hero shows lantern), undo → v${un.brief.version}: page identical to v${v2.brief.version}`);
}

// Export: the workspace's own .zip, unzipped somewhere new, QA'd from disk with no network.
const unz = path.join(out, "export");
await writeFile(path.join(out, `${slug}.zip`), (await ws.zipWorkspace(uid, slug))!);
execFileSync("unzip", ["-oq", path.join(out, `${slug}.zip`), "-d", unz]);
await mkdir(path.join(unz, "qa"), { recursive: true });
const hero = v2.brief.assets.find((a) => a.id === "hero");
const packet = await qaExport(unz, { version: String(v2.brief.version), hero, shots: path.join(unz, "qa"), shotPrefix: "qa/" });
const md = qaMarkdown(packet);
// The QA packet goes back into the workspace so the next .zip carries it (screenshots included).
for (const v of packet.viewports) { const r = await ws.writeWsFile(uid, slug, v.shot, new Uint8Array(await readFile(path.join(unz, v.shot)))); if ("error" in r) console.warn(`qa shot ${v.shot}: ${r.error}`); }
await ws.writeWsFile(uid, slug, "qa/report.md", md);
await ws.writeWsFile(uid, slug, "qa/report.json", JSON.stringify(packet, null, 2));
await writeFile(path.join(out, `${slug}.zip`), (await ws.zipWorkspace(uid, slug))!);
await writeFile(path.join(unz, "qa/report.md"), md);
// Optional art-director pass (--art): the QA screenshots judged against the cinematic standard by the vision model on the local CLI.
if (process.argv.includes("--art")) {
  const { artReview } = await import("../src/lib/art-director.ts");
  const { artMarkdown } = await import("../src/lib/art-director-pure.ts");
  const art = await artReview(packet.viewports.map((v) => path.join(unz, v.shot)), "site", { context: `${v2.brief.name}: ${v2.brief.offer}` });
  if ("error" in art) console.log(`art review skipped: ${art.error}`);
  else { await writeFile(path.join(unz, "qa/art.md"), artMarkdown(art)); console.log(`art review ${art.verdict} ${art.score}/100 → qa/art.md`); }
}
for (const v of packet.viewports) await cp(path.join(unz, v.shot), path.join(out, `w02-${v.vw}.jpg`));
console.log(md);

// Failing control: a deliberately broken page must fail the same QA.
const bad = path.join(out, "broken");
await mkdir(path.join(bad, "assets"), { recursive: true });
await cp(path.join(fx, "broken.html"), path.join(bad, "index.html"));
await cp(path.join(unz, "assets/hero.jpg"), path.join(bad, "assets/hero.jpg"));
const control = await qaExport(bad, { version: "control", shots: bad });
console.log(`control (broken page): ${control.pass ? "PASS (wrong!)" : "FAIL as expected"}; failing checks: ${control.checks.filter((c) => !c.ok).map((c) => c.name).join(", ")}`);
if (!packet.pass) fail("the demo site failed its QA");
if (control.pass) fail("the broken control passed");
console.log(`OK. Export: ${path.join(out, `${slug}.zip`)}`);
