// Fixture-only password sign-in navigation with the real login page.
// node scripts/login-deeplink-ui.mjs (Playwright Chromium or ORBIT_CHROMIUM).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";

const { chromium } = createRequire(import.meta.url)("playwright-core");
const origin = "http://orbit.test";
const js = (await build({
  stdin: { contents: `import { createRoot } from "react-dom/client";
import Login from "@/app/login/page";
createRoot(document.getElementById("root")).render(<Login />);`,
    loader: "tsx", resolveDir: resolve("src") },
  bundle: true, write: false, format: "esm", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{
    name: "fixture-auth",
    setup(b) {
      b.onResolve({ filter: /^@\/lib\/supabase\/client$/ }, () => ({ path: "auth", namespace: "fixture" }));
      b.onLoad({ filter: /^auth$/, namespace: "fixture" }, () => ({
        contents: `export const createClient = () => ({ auth: {
          signInWithPassword: async ({ password }) => {
            if (password !== "fixture-success") return { error: { message: "Invalid login credentials" } };
            return { error: null };
          },
        } });`,
      }));
    },
  }],
})).outputFiles[0].text;

const browser = await chromium.launch({ executablePath: process.env.ORBIT_CHROMIUM });
try {
  for (const [hash, target] of [
    ["#o=core", "/#o=core"],
    ["#o=business&v=client&k=client&id=fixture-1&extra=ignore", "/#o=business&v=client&k=client&id=fixture-1"],
    ["#o=https://outside.test", "/"],
    ["", "/"],
  ]) {
    const page = await browser.newPage();
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/login") return route.fulfill({ contentType: "text/html", body: '<!doctype html><div id="root"></div><script type="module" src="/app.js"></script>' });
      if (url.pathname === "/app.js") return route.fulfill({ contentType: "text/javascript", body: js });
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: "<p>Fixture home</p>" });
      return route.fulfill({ status: 404, body: "No fixture" });
    });
    await page.goto(origin + "/login" + hash);
    await page.getByRole("button", { name: "Sign in with password" }).click();
    await page.getByLabel("Email").fill("fixture@example.test");
    if (hash === "#o=core") {
      await page.getByLabel("Password").fill("fixture-fail");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("alert").waitFor();
      assert.equal(page.url(), origin + "/login" + hash);
    }
    await page.getByLabel("Password").fill("fixture-success");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByText("Fixture home").waitFor();
    assert.equal(page.url(), origin + target);
    await page.close();
    console.log(`PASS ${hash || "(no hash)"} -> ${target}`);
  }
} finally {
  await browser.close();
}
