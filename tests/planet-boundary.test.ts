import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// A crash inside a planet (its 3D scene with no WebGL, or its panel) must stay inside it: top bar and home keep working.
const require = createRequire(import.meta.url);
const src = (f: string) => readFileSync(new URL(`../src/components/${f}`, import.meta.url), "utf8");
function boundary() {
  const out = ts.transpileModule(src("PlanetBoundary.tsx"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const stubs: Record<string, unknown> = { "./i18n": { useT: () => ({ t: (k: string) => k }) }, "@/lib/stale-build-pure": { isChunkError: () => false }, "./StaleBuildWatch": { reloadOnce() {} }, "./ui": { Button: () => null } };
  const module = { exports: {} as Record<string, any> };
  runInNewContext(out, { exports: module.exports, module, console: { error() {} }, require: (m: string) => stubs[m] ?? require(m) });
  return module.exports.PlanetBoundary;
}

test("boundary: a thrown error shows the card; quiet parts drop out", () => {
  const B = boundary();
  assert.equal(B.getDerivedStateFromError(new Error("x")).failed, true);
  const loud = new B({ name: "operations", children: "kid" }); loud.state = { failed: true, n: 0 };
  const card = loud.render(); assert.ok(card && card.props.name === "operations", "crash card");
  const quiet = new B({ name: "operations-scene", quiet: true, children: "kid" }); quiet.state = { failed: true, n: 0 };
  assert.equal(quiet.render(), null);
  quiet.state = { failed: false, n: 0 }; assert.equal(quiet.render().props.children, "kid");
});

test("every planet world sits inside a boundary, and its 3D scene in a quiet one", () => {
  const orbit = src("Orbit.tsx");
  assert.match(orbit, /<PlanetBoundary key=\{`w-\$\{shown\}`\}[^>]*>\s*<PlanetWorld /);
  assert.match(orbit, /function Kept\([^]{0,400}<PlanetBoundary name=\{name\}/);
  assert.match(src("PlanetWorld.tsx"), /<PlanetBoundary name=\{`\$\{id\}-scene`\} quiet>\s*<Canvas/);
});

test("plainError: never the server's words; known failures get their plain sentence", async () => {
  const { plainError, TEXT } = await import("../src/lib/api-error-pure.ts");
  assert.equal(plainError(new Error("relation \"x\" does not exist at /srv/app.js:12"), "Couldn't save. Try again.", {}), "Couldn't save. Try again.");
  assert.equal(plainError("not in harness", "Couldn't load this.", {}), "Couldn't load this.");
  const t = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  assert.equal(plainError(t, "x", {}), TEXT.timeout);
});

test("AGENTS and Profile show kit states, not server text", () => {
  const ag = src("AgentsStation.tsx"), pr = src("panels.tsx");
  assert.match(ag, /<PlanetShell planet="agents"/);
  assert.doesNotMatch(ag, /StateNote|MaskText|>\{err\}<|AGENTS STATION|>ACTIVITY</);
  const profile = pr.slice(pr.indexOf("export function ProfilePanel"), pr.indexOf("export function ProfilePanel") + 4000);
  assert.doesNotMatch(profile, /e\.message|e2\.message/);
  for (const f of ["AutonomySection", "AuthoritySection", "CoreEngineSection", "PlaceSection", "PhonePairing", "PersonaSection", "LessonsCard", "PluginsSection", "TimeCapsuleSection", "PasswordSection", "DubVoice"])
    assert.doesNotMatch(src(`${f}.tsx`), /setErr\(j\?\.error|setMsg\(j\.error|setMsg\(e\.message|\.message : /, f);
});

test("a site-logo share picture falls back to the source mark", async () => {
  const { looksLikeLogo, ogImageOf } = await import("../src/lib/intel-rich-pure.ts");
  for (const u of ["https://s.yimg.com/cv/apiv2/social/images/yahoo_default_logo-1200x1200.png", "https://x.com/static/default-og.png", "https://cdn.err.ee/logos/err.png", "https://x.com/favicon.ico"]) assert.ok(looksLikeLogo(u), u);
  for (const u of ["https://media.zenfs.com/en/reuters.com/abc123.jpg", "https://x.com/news/logistics-hub.jpg", "https://img.x.com/2026/11/catalogue-photo.jpg"]) assert.ok(!looksLikeLogo(u), u);
  assert.equal(ogImageOf('<head><meta property="og:image" content="https://s.yimg.com/cv/apiv2/social/images/yahoo_default_logo-1200x1200.png"></head>', "https://news.yahoo.com/a"), null);
  assert.equal(ogImageOf('<head><meta property="og:image" content="/img/story.jpg"></head>', "https://news.example/a"), "https://news.example/img/story.jpg");
});
