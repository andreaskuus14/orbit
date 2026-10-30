import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkBrief, generatorOff, GEN_LICENSE, parseRefs } from "../src/lib/site-inspire-pure.ts";
import { inspireImage, saveGenerated, type InspireIO } from "../src/lib/site-inspire.ts";
import { parseCredits } from "../src/lib/site-pipeline-pure.ts";
import { decide } from "../src/lib/policy-pure.ts";

const good = { subject: "a sunlit cafe table with a ceramic cup", mood: "calm, slow morning", palette: "warm cream, terracotta, sage", lighting: "soft window light", composition: "close-up, shallow depth of field", style: "natural photo" };

test("brief check: generic descriptors pass, brands, characters, artists and logos are refused", () => {
  const ok = checkBrief(good);
  assert.ok(typeof ok !== "string" && /^a sunlit cafe table/.test(ok.prompt) && /no logos/.test(ok.prompt));
  for (const bad of ["a runner with the nike logo", "mickey mouse waving", "street art in the style of banksy", "Mickey Mouse", "a shoe by Nike", "poster after the manner of hokusai", "a can with a ™ mark", "a watermark in the corner"])
    assert.equal(typeof checkBrief({ ...good, subject: bad }), "string", bad);
  assert.match(checkBrief({ ...good, style: "inspired by Van Gogh" }) as string, /generic words/);
  assert.match(checkBrief({ ...good, mood: "" }) as string, /mood is missing/);
  assert.equal(typeof checkBrief({ ...good, subject: "Warm cafe table. Cups on it" }), "object"); // sentence starts are fine
});

test("references are words only: no image URL is kept", () => {
  const refs = parseRefs({ results: [{ title: "Cafe <b>morning</b>", url: "https://img.example/x.jpg", thumbnail: "https://img.example/t.jpg", tags: [{ name: "coffee" }], foreign_landing_url: "https://flickr.com/p/1" }] });
  assert.deepEqual(refs, [{ title: "Cafe morning", tags: ["coffee"], source: "https://flickr.com/p/1" }]);
});

function io(over: Partial<InspireIO> = {}) {
  const calls: { urls: string[]; queued: unknown[] } = { urls: [], queued: [] };
  const v: InspireIO = {
    fetch: async (u) => { calls.urls.push(u); return Response.json({ results: [{ title: "Sunny cafe", url: "https://img.example/x.jpg", tags: [{ name: "latte" }], foreign_landing_url: "https://x.example/p" }] }); },
    generator: async () => ({ ok: true, model: "m1" }),
    queue: async (d, site) => { calls.queued.push({ d, site }); return "job1"; },
    ...over,
  };
  return { v, calls };
}

test("search phase: only the search API is fetched, nothing is queued (and nothing can be written: the IO has no write)", async () => {
  const { v, calls } = io();
  const out = await inspireImage({ query: "cafe interior", purpose: "hero" }, "u", "cafe", v);
  assert.equal(calls.urls.length, 1);
  assert.match(calls.urls[0], /^https:\/\/api\.openverse\.org\/v1\/images\/\?q=cafe%20interior/);
  assert.equal(calls.queued.length, 0);
  assert.match(out, /Sunny cafe \[latte\]/);
  assert.doesNotMatch(out, /img\.example/);
});

test("brief phase: queues a priced draft for approval, never generates; bad briefs and no generator never queue", async () => {
  const { v, calls } = io();
  const out = await inspireImage({ purpose: "hero", brief: good, count: 2 }, "u", "cafe", v);
  assert.match(out, /^Pending approval: "Generate 2 images for cafe"/);
  assert.match(out, /Nothing is generated or spent until the owner clicks Approve/);
  assert.deepEqual(calls.queued, [{ d: { kind: "image", prompt: (checkBrief(good) as { prompt: string }).prompt, model: "m1", count: 2, aspect: "16:9" }, site: { user: "u", workspace: "cafe", purpose: "hero", brief: (checkBrief(good) as { prompt: string }).prompt } }]);
  assert.equal(calls.urls.length, 0); // the brief phase looks at nothing on the web

  const bad = io();
  assert.match(await inspireImage({ brief: { ...good, subject: "Mickey Mouse" } }, "u", "cafe", bad.v), /^Error: /);
  const off = io({ generator: async () => ({ ok: false, model: "m1" }) });
  assert.match(await inspireImage({ brief: good }, "u", "cafe", off.v), /ws_fetch_image \(licensed\) or draw an inline SVG/);
  assert.equal(bad.calls.queued.length + off.calls.queued.length, 0);
  assert.equal(generatorOff({ ORBIT_HIGGSFIELD_WEEKLY_CAP: "0" }), true);
  assert.equal(generatorOff({}), false);
});

test("after approval: the generated file lands in assets/ with the AI-generated credit and the brief", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "inspire-"));
  const f = path.join(dir, "image-0.png");
  await writeFile(f, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]));
  const files: Record<string, string | Uint8Array> = { "assets/CREDITS.md": "# Image credits\n\n- `assets/old.jpg` — Old by Ann (CC0), Openverse <https://x>\n" };
  const out = await saveGenerated({ user: "u", workspace: "cafe", purpose: "Hero image", brief: "a sunlit cafe table" }, "m1", [f], {
    read: async (p) => (typeof files[p] === "string" ? files[p] as string : null),
    write: async (p, d) => { files[p] = d; return { path: p, bytes: d.length }; },
  });
  assert.equal(out, "saved assets/hero-image.png in workspace cafe");
  assert.ok(files["assets/hero-image.png"] instanceof Uint8Array);
  const credits = parseCredits(files["assets/CREDITS.md"] as string);
  assert.equal(credits.length, 2); // the licensed entry is kept
  assert.equal(credits[1].license, GEN_LICENSE);
  assert.match(credits[1].title, /^Brief: a sunlit cafe table/);
  assert.match(files["assets/CREDITS.md"] as string, /AI-generated from an original brief — no reference image used as input/);
});

test("policy: ws_inspire_image is T3 behind the owner's ask, like ws_fetch_image", () => {
  const ctx = (question: string) => ({ question, steps: [], attach: false, pins: false, stopAll: false });
  assert.equal(decide("ws_inspire_image", { workspace: "cafe" }, ctx("build me a cafe website with nice pictures")).allow, true);
  assert.equal(decide("ws_inspire_image", { workspace: "cafe" }, ctx("how are you?")).allow, false);
});
