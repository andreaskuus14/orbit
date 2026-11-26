// Bakes conifer impostors from Poly Haven's fir_sapling (CC0, https://polyhaven.com/a/fir_sapling): the full-detail model is rendered from the front and the side
// (orthographic, transparent) into one 2048x2048 image (downscaled 4x to a 1024 atlas by fir-atlas.py): [variant a front | a side] / [variant c front | c side]. The editor draws each tree as two crossed
// alpha-cut cards (the way a game draws a forest: a 22 MB model with 15 000 needle sprigs is useless 70 m away). Run: node fir-bake.mjs <folder> <out.png>
// folder = fir_sapling_1k.gltf, fir_sapling.bin, textures/*, plus textures/twigs_alpha8.png (the 16-bit alpha png converted to 8-bit grey).
import { createRequire } from "node:module"; import { readFileSync, writeFileSync, existsSync } from "node:fs"; import { extname } from "node:path";
const ROOT = process.env.ROOT || "/home/claude/wt-arch", req = createRequire(ROOT + "/package.json");
const { chromium } = req("playwright-core"); const { build } = req("esbuild");
const [src, out, model = "fir_sapling_medium"] = process.argv.slice(2);
const entry = `import * as THREE from "three"; import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
const cv = document.createElement("canvas"); cv.width = 2048; cv.height = 2048; document.body.appendChild(cv);
const r = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
r.setPixelRatio(1); r.setSize(2048, 2048, false); r.setClearColor(0x000000, 0); r.outputColorSpace = THREE.SRGBColorSpace; r.setScissorTest(true);
const g = await new GLTFLoader().loadAsync("/fir/" + MODEL + "_1k.gltf");
const alpha = await new THREE.TextureLoader().loadAsync("/fir/textures/twigs_alpha8.png"); alpha.wrapS = alpha.wrapT = THREE.RepeatWrapping; alpha.flipY = false;
g.scene.traverse((o) => { if (!o.isMesh) return; for (const m of [].concat(o.material)) { if (/twigs/.test(m.name)) { m.alphaMap = alpha; m.alphaTest = 0.3; m.transparent = false; m.side = THREE.DoubleSide; if (m.map) m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping; m.needsUpdate = true; } } });
const sc = new THREE.Scene(); sc.add(g.scene); sc.add(new THREE.HemisphereLight(0xffffff, 0x8a8a70, 1.7)); const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(0.4, 1, 1); sc.add(sun);
const cells = [[MODEL + "_a_LOD0", 0, 0], [MODEL + "_c_LOD0", 0, 1]];
const info = [];
for (const [name, col, row] of cells) {
  const n = g.scene.getObjectByName(name); g.scene.traverse((o) => { if (o.parent === g.scene) o.visible = o === n; });
  const box = new THREE.Box3().setFromObject(n), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3()), side = Math.max(sz.y, sz.x, sz.z) * 1.06, bottom = box.min.y - side * 0.015;
  info.push({ name, w: sz.x, d: sz.z, h: sz.y, side, bottom: box.min.y });
  for (let v = 0; v < 2; v++) {
    const cam = new THREE.OrthographicCamera(-side / 2, side / 2, side / 2, -side / 2, 0.01, 200), mid = bottom + side / 2;
    cam.position.set(c.x + (v ? 60 : 0), mid, c.z + (v ? 0 : 60)); cam.lookAt(c.x, mid, c.z);
    const x = v * 1024, y = 1024 * (1 - row); r.setViewport(x, y, 1024, 1024); r.setScissor(x, y, 1024, 1024); r.clear(); r.render(sc, cam);
  }
}
window.__info = info; window.__png = cv.toDataURL("image/png"); window.__done = true;`;
const js = (await build({ stdin: { contents: entry.replaceAll("MODEL", JSON.stringify(model)), loader: "js", resolveDir: ROOT + "/node_modules" }, bundle: true, write: false, format: "esm", logLevel: "error", nodePaths: [ROOT + "/node_modules"], target: "es2022" })).outputFiles[0].text;
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
const page = await (await browser.newContext({ viewport: { width: 1024, height: 1024 } })).newPage();
await page.route("http://bake.test/**", async (rt) => { const u = new URL(rt.request().url()).pathname;
  if (u === "/") return rt.fulfill({ contentType: "text/html", body: `<!doctype html><body style="margin:0"><script type="module" src="/app.js"></script>` });
  if (u === "/app.js") return rt.fulfill({ contentType: "text/javascript", body: js });
  const f = src + u.replace("/fir", ""); if (existsSync(f)) return rt.fulfill({ contentType: extname(f) === ".png" ? "image/png" : extname(f) === ".jpg" ? "image/jpeg" : "application/octet-stream", body: readFileSync(f) }); return rt.fulfill({ status: 404, body: "" }); });
page.on("pageerror", (e) => console.log("pageerror", e.message.slice(0, 300))); page.on("console", (m) => { if (m.type() === "error") console.log("console", m.text().slice(0, 200)); });
await page.goto("http://bake.test/"); await page.waitForFunction(() => window.__done, null, { timeout: 300000 });
const { png, info } = await page.evaluate(() => ({ png: window.__png, info: window.__info })); await browser.close();
writeFileSync(out, Buffer.from(png.split(",")[1], "base64")); console.log(JSON.stringify(info));
