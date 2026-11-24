// node --import ./scripts/a11y-axe-hook.mjs --no-warnings --experimental-strip-types scripts/<planet>-ui.mjs
// Runs axe-core (WCAG 2 A/AA) on every screenshot a planet harness takes, so each harness state (shell, sheet, menu) gets checked
// with the harness's own fixture data. axe-core is MPL-2.0, so it is NOT a dependency: point AXE_PATH at a local axe.min.js
// (e.g. `npm i --no-save --prefix /tmp/axe axe-core` → /tmp/axe/node_modules/axe-core/axe.min.js). Without AXE_PATH this hook does nothing.
// Off: document-title and page-has-heading-one (the harness page is a bare fixture; the app sets both in layout.tsx / Orbit.tsx).
// Out: A11Y_OUT (default ./smoke-shots/a11y)/<script>-<A11Y_TAG>.json — per screen: violation count, rules, nodes.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";

const AXE = process.env.AXE_PATH;
if (AXE) {
  const src = readFileSync(AXE, "utf8");
  const req = createRequire(resolve("package.json"));
  const pw = (() => { try { return req("playwright"); } catch { return req("playwright-core"); } })();
  const script = basename(process.argv[1] || "x").replace(/\.mjs$/, "");
  const out = resolve(process.env.A11Y_OUT || "smoke-shots/a11y");
  const results = {};
  let patched = false;
  const patch = (page) => {
    if (patched) return page;
    patched = true;
    const proto = Object.getPrototypeOf(page), shot = proto.screenshot;
    proto.screenshot = async function (opts = {}) {
      const name = basename(opts.path || `shot-${Object.keys(results).length}`).replace(/\.(png|jpe?g)$/, "");
      try {
        await this.evaluate(src);
        const r = await this.evaluate(() => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }, resultTypes: ["violations", "incomplete"], rules: { "document-title": { enabled: false }, "page-has-heading-one": { enabled: false } } }));
        const unsure = (r.incomplete.find((v) => v.id === "color-contrast")?.nodes.length) ?? 0; // contrast axe could not decide (text over glass/blur): check by eye
        results[name] = { contrastUnsure: unsure, count: r.violations.reduce((n, v) => n + v.nodes.length, 0), rules: r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => ({ target: n.target.join(" "), html: n.html.slice(0, 160), why: n.failureSummary?.split("\n").slice(1, 2).join(" ").trim() })) })) };
      } catch (e) { results[name] = { error: String(e).slice(0, 200) }; }
      return shot.call(this, opts);
    };
    return page;
  };
  const launch = pw.chromium.launch.bind(pw.chromium);
  pw.chromium.launch = async (...a) => {
    const b = await launch(...a);
    const np = b.newPage.bind(b), nc = b.newContext.bind(b);
    b.newPage = async (...x) => patch(await np(...x));
    b.newContext = async (...x) => { const c = await nc(...x); const cp = c.newPage.bind(c); c.newPage = async (...y) => patch(await cp(...y)); return c; };
    return b;
  };
  process.on("exit", () => {
    mkdirSync(out, { recursive: true });
    writeFileSync(`${out}/${script}-${process.env.A11Y_TAG || "run"}.json`, JSON.stringify(results, null, 1));
  });
}
