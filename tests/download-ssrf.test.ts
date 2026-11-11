import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

// Higgsfield result downloads (fetchTo) and owner-supplied site images go through safeFetch, so a URL (or a redirect) to a
// private address is refused before any connection, while size and type checks still apply. Run in a child: memory.ts needs the resolver.
test("fetchTo and site image downloads refuse private addresses; their size/type checks stay", async () => {
  const root = path.join(import.meta.dirname, "..");
  const mod = (p: string) => JSON.stringify(pathToFileURL(path.join(root, p)).href);
  const code = `
const { fetchTo } = await import(${mod("src/lib/clips/higgsfield.ts")});
const { fetchImage } = await import(${mod("src/lib/site-images.ts")});
const err = (p) => p.then(() => "ok", (e) => e.message);
const out = {
  loop: await err(fetchTo("https://127.0.0.1/x.png", "/nonexistent/x", AbortSignal.timeout(5000))),
  meta: await err(fetchTo("https://[::ffff:a9fe:a9fe]/latest", "/nonexistent/x", AbortSignal.timeout(5000))),
  http: await err(fetchTo("http://example.com/x.png", "/nonexistent/x", AbortSignal.timeout(5000))),
  img: await fetchImage({ workspace: "w", url: "https://10.0.0.5/a.jpg" }, "use https://10.0.0.5/a.jpg", { read: async () => null, write: async () => ({ error: "no" }) }),
};
console.log(JSON.stringify(out)); process.exit(0);`;
  const { stdout } = await promisify(execFile)(process.execPath, ["--no-warnings", "--experimental-transform-types", "--import", pathToFileURL(path.join(root, "tests/fixtures/ts-resolve.mjs")).href,
    "--input-type=module", "-e", code], { cwd: root, timeout: 60_000 });
  const got = JSON.parse(stdout.trim().split("\n").pop()!);
  assert.match(got.loop, /not publicly reachable/);
  assert.match(got.meta, /not publicly reachable/);
  assert.match(got.http, /must be https/);
  assert.match(got.img, /not publicly reachable/);
});
