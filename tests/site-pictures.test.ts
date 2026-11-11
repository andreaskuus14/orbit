import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bySite, draftsSummary, mergeSlots, openSiteJob, parseSlots, placeholderSvg, slotItems, studioSection, type Slot } from "../src/lib/site-pictures-pure.ts";
import { pictureDraft, saveGenerated, type PictureIO } from "../src/lib/site-inspire.ts";
import { factsLine, lintDepth, nextSiteStep, wantsBackend } from "../src/lib/site-pipeline-pure.ts";
import { decide } from "../src/lib/policy-pure.ts";
import type { StoryJob } from "../src/lib/clips/story-pure.ts";

const hero = { path: "img/hero.jpg", prompt: "a golf green at sunrise with dew on the grass", aspect: "16:9" };

test("slots: relative raster paths once each, a real prompt, a known aspect; brands refused", () => {
  assert.deepEqual(parseSlots({ slots: [{ ...hero, path: "./IMG/hero.jpg", aspect: undefined }] }), [{ ...hero }]);
  for (const [bad, re] of [
    [{}, /slots must be a list/], [{ slots: [] }, /slots must be a list/],
    [{ slots: [{ ...hero, path: "../x.jpg" }] }, /path must be/], [{ slots: [{ ...hero, path: "img/a.svg" }] }, /path must be/],
    [{ slots: [{ ...hero, path: "/etc/a.jpg" }] }, /path must be/], [{ slots: [hero, hero] }, /listed twice/],
    [{ slots: [{ ...hero, prompt: "golf" }] }, /prompt must be/],
    [{ slots: [{ ...hero, prompt: "a golfer wearing a nike logo cap on the green" }] }, /names "nike"/],
    [{ slots: Array.from({ length: 9 }, (_, i) => ({ ...hero, path: `img/${i}.jpg` })) }, /at most 8/],
  ] as const) assert.match(parseSlots(bad) as string, re, JSON.stringify(bad));
});

test("slot items, merge, stand-in art", () => {
  const items = slotItems([hero, { ...hero, path: "img/club.webp", aspect: "4:3" }], "m1");
  assert.deepEqual(items.map((i) => [i.key, i.index, i.params.aspect_ratio, i.params.model]), [["slot-0", 0, "16:9", "m1"], ["slot-1", 1, "4:3", "m1"]]);
  assert.match(String(items[0].params.prompt), /^a golf green at sunrise.*no text, no logos/);
  const merged = mergeSlots([hero, { ...hero, path: "img/b.jpg" }], [{ ...hero, prompt: "new hero prompt text" }]);
  assert.deepEqual(merged.map((s) => [s.path, s.prompt]), [["img/b.jpg", hero.prompt], ["img/hero.jpg", "new hero prompt text"]]);
  const svg = placeholderSvg(hero);
  assert.match(svg, /^<svg [^>]*width="1600" height="900"/);
  assert.doesNotMatch(svg, /<text|<script|href=/); // pure shapes: nothing to read, nothing to load
  assert.match(placeholderSvg({ ...hero, aspect: "9:16" }), /width="900" height="1600"/);
});

const job = (o: Partial<StoryJob>): StoryJob => ({ v: 1, id: "a", createdAt: "2026-10-31T10:00:00Z", updatedAt: "", status: "quoted", step: "Costs 4 credits", opts: { idea: "", style: "", length: 0, voice: "none", motion: "stills" },
  story: { title: "x", hook: "", scenes: [] }, items: [], warnings: [], ...o });
const site = (workspace: string, slots?: Slot[]) => ({ user: "u", workspace, purpose: "site pictures", brief: "", slots });
const draft = { kind: "image" as const, prompt: "p", model: "m", count: 1, aspect: "16:9" };

test("STUDIO sections: site drafts → Websites, stories and long-form → YouTube, plain drafts → Other", () => {
  assert.equal(studioSection(job({ draft, site: site("fairway", [hero]) })), "websites");
  assert.equal(studioSection(job({ draft, site: site("cafe") })), "websites"); // ws_inspire_image jobs too
  assert.equal(studioSection(job({})), "youtube");
  assert.equal(studioSection(job({ draft, story: { title: "Long-form: 3× image, x", hook: "", scenes: [] } })), "youtube");
  assert.equal(studioSection(job({ draft, story: { title: "CORE: 1× image, fox", hook: "", scenes: [] } })), "other");
  const g = bySite([job({ id: "1", site: site("a") }), job({ id: "2" }), job({ id: "3", site: site("b") }), job({ id: "4", site: site("a") })]);
  assert.deepEqual(g.map((x) => [x.workspace, x.jobs.map((j) => j.id)]), [["a", ["1", "4"]], ["b", ["3"]]]);
});

test("one open draft per site: merge only into an unapproved, unsubmitted slot job of the same site", () => {
  const open = job({ id: "o", draft, site: site("fairway", [hero]) });
  assert.equal(openSiteJob([open], "u", "fairway")?.id, "o");
  assert.equal(openSiteJob([open], "u", "other"), undefined);
  assert.equal(openSiteJob([{ ...open, approved: [{ at: "", credits: 1 }] }], "u", "fairway"), undefined);
  assert.equal(openSiteJob([{ ...open, status: "done" }], "u", "fairway"), undefined);
  assert.equal(openSiteJob([{ ...open, items: [{ key: "slot-0", kind: "image", scene: 0, index: 0, params: {}, jobId: "j" }] }], "u", "fairway"), undefined);
  assert.equal(openSiteJob([{ ...open, site: site("fairway") }], "u", "fairway"), undefined); // ws_inspire_image job: no slots
});

test("studio_drafts summary: where each draft waits and its state", () => {
  const s = draftsSummary([job({ draft, site: site("fairway", [hero]), quote: { total: 4, balance: 10, plan: null, fingerprint: "f", at: "" } }), job({ draft, status: "done", step: "Done" })]);
  assert.match(s, /img\/hero\.jpg: waiting for the owner's Approve click \(4 credits\)\. .*In STUDIO → Websites → fairway/);
  assert.match(s, /1× image: made\. Done\. In STUDIO → Other/);
  assert.equal(draftsSummary([], "x"), "No picture drafts for x in STUDIO.");
});

function pio(over: Partial<PictureIO> = {}) {
  const calls = { drawn: [] as string[], queued: [] as Slot[][] };
  const v: PictureIO = {
    exists: async (p) => p === "img/team.jpg",
    placeholder: async (s) => { calls.drawn.push(s.path); return true; },
    generator: async () => ({ ok: true, model: "m1" }),
    queue: async (slots) => { calls.queued.push(slots); return { id: "j", slots: slots.length }; },
    ...over,
  };
  return { v, calls };
}

test("ws_picture_draft: stand-ins for missing paths, one priced draft, never generates; no generator → nothing queued", async () => {
  const { v, calls } = pio();
  const out = await pictureDraft({ slots: [hero, { ...hero, path: "img/team.jpg" }] }, "u", "fairway", v);
  assert.deepEqual(calls.drawn, ["img/hero.jpg"]); // an existing picture is never overwritten by a stand-in
  assert.equal(calls.queued.length, 1);
  assert.match(out, /^Done: Drew stand-in art at img\/hero\.jpg.*no credits are spent.*STUDIO → Websites → fairway.*never send him to look in Higgsfield/);
  const off = pio({ generator: async () => ({ ok: false, model: "m1" }) });
  assert.match(await pictureDraft({ slots: [hero] }, "u", "fairway", off.v), /nothing was drafted/);
  assert.equal(off.calls.queued.length, 0);
  assert.match(await pictureDraft({ slots: [{ ...hero, path: "x.gif" }] }, "u", "fairway", v), /^Error: /);
});

test("after approval: each photo is saved at its slot's exact path", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sitepics-"));
  const f = path.join(dir, "slot-0.png");
  await writeFile(f, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]));
  const files: Record<string, string | Uint8Array> = {};
  const out = await saveGenerated({ user: "u", workspace: "fairway", purpose: "site pictures", brief: "" }, "m1", [f], {
    read: async (p) => (typeof files[p] === "string" ? files[p] as string : null),
    write: async (p, d) => { files[p] = d; return { path: p, bytes: d.length }; },
  }, ["img/hero.jpg"]);
  assert.equal(out, "saved img/hero.jpg in workspace fairway");
  assert.ok(files["img/hero.jpg"] instanceof Uint8Array);
  assert.match(files["assets/CREDITS.md"] as string, /img\/hero\.jpg/);
});

test("depth lint: no pictures, thin text, a form that saves nothing, a back end asked for but static", () => {
  const thin = { html: [{ path: "index.html", text: "<html><body><h1>Fairway</h1><form><input name=a></form></body></html>" }], css: [{ path: "css/style.css", text: "header{background:linear-gradient(#0a0,#060)}" }], images: [] };
  const issues = lintDepth({ ...thin, wantsBackend: wantsBackend("build a golf site with a booking system that saves to a database") });
  for (const re of [/no pictures, SVG or illustration/, /<form> has no handler/, /fullstack/]) assert.ok(issues.some((i) => re.test(i)), String(re));
  assert.equal(factsLine(thin), "0 pictures/SVG, 7 chars of text, 1 form (no handler)");
  const rich = { html: [{ path: "index.html", text: `<html><body><img src="img/hero.jpg" alt=""><svg></svg><h1>Fairway golf club</h1><p>${"Real words about the club. ".repeat(80)}</p><form id=f></form><script>f.addEventListener("submit", e => e.preventDefault())</script></body></html>` }], css: [], images: [], fullstack: true, wantsBackend: true };
  assert.deepEqual(lintDepth(rich), []);
  assert.match(factsLine(rich), /^2 pictures\/SVG, \d{4} chars of text, 1 form$/);
  const long = lintDepth({ ...rich, html: [{ path: "index.html", text: `<h1>The best golf club you will ever play on</h1><section><p>${"word ".repeat(120)}</p></section><p>${"more ".repeat(400)}</p>` }] });
  for (const re of [/hero headline has 9 words/, /1 section over about 80 words \(120\)/, /529 visible words/]) assert.ok(long.some((i) => re.test(i)), String(re));
  assert.equal(wantsBackend("make me a simple landing page for a bakery"), false);
  assert.equal(nextSiteStep(["plan.md", "css/style.css", "index.html", "img/hero.jpg"]), "check"); // slot photos count as images
});

test("policy: ws_picture_draft is T3 behind the owner's build ask; studio_drafts is a read", () => {
  const ctx = (question: string) => ({ question, steps: [], attach: false, pins: false, stopAll: false });
  assert.equal(decide("ws_picture_draft", { workspace: "fairway" }, ctx("make the fairway site with realistic pictures")).allow, true);
  assert.equal(decide("ws_picture_draft", { workspace: "fairway" }, ctx("how are you?")).allow, false);
  assert.equal(decide("ws_picture_draft", { workspace: "fairway" }, { ...ctx("make the fairway site with realistic pictures"), stopAll: true }).allow, false);
  assert.equal(decide("studio_drafts", {}, ctx("did the pictures get made?")).allow, true);
});

test("free photos: made now for every slot without a photo; failures fall to the priced draft; nothing queued when all made", async () => {
  const made: string[] = [];
  const all = pio({ free: async (s) => { made.push(s.path); return true; }, hasPhoto: async (p) => p === "img/old.jpg" });
  const out = await pictureDraft({ slots: [hero, { ...hero, path: "img/team.jpg" }, { ...hero, path: "img/old.jpg" }] }, "u", "fairway", all.v);
  assert.deepEqual(made.sort(), ["img/hero.jpg", "img/team.jpg"]); // a credited photo isn't made again
  assert.equal(all.calls.queued.length, 0);
  assert.match(out, /^Done: .*Made 2 realistic photos for free.*nothing was spent.*No approval is needed/);
  const some = pio({ free: async (s) => s.path !== "img/team.jpg" });
  const out2 = await pictureDraft({ slots: [hero, { ...hero, path: "img/team.jpg" }] }, "u", "fairway", some.v);
  assert.deepEqual(some.calls.queued.map((q) => q.map((s) => s.path)), [["img/team.jpg"]]);
  assert.match(out2, /free generator failed for img\/team\.jpg/);
});

test("free photo URLs: keyed endpoint first only with a key; prompt encoded, size and seed stable", async () => {
  const { freeImageUrls } = await import("../src/lib/site-pictures-pure.ts");
  const a = freeImageUrls(hero), b = freeImageUrls(hero, "k1");
  assert.equal(a.length, 1);
  assert.match(a[0].url, /^https:\/\/image\.pollinations\.ai\/prompt\/[^?/]+\?model=flux&width=1200&height=675&seed=\d+&nologo=true/);
  assert.equal(b.length, 2);
  assert.match(b[0].url, /^https:\/\/gen\.pollinations\.ai\/image\//);
  assert.equal(b[0].headers.Authorization, "Bearer k1");
  assert.equal(freeImageUrls(hero)[0].url, a[0].url);
});

test("freePicture: skips errors and tiny/non-image replies, returns the first real photo", async () => {
  const { freePicture } = await import("../src/lib/site-inspire.ts");
  const jpg = new Uint8Array(9000); jpg.set([0xff, 0xd8, 0xff, 0xe0]);
  let n = 0;
  const f = (async () => { n++; return n === 1 ? new Response("rate limited", { status: 429 }) : new Response(jpg); }) as unknown as typeof fetch;
  assert.equal((await freePicture(hero, f, "k"))?.length, 9000);
  assert.equal(await freePicture(hero, (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch, ""), null);
});

test("free photos: one at a time, a refused one retried, a time budget leaves the rest as stand-ins", async () => {
  let calls = 0, live = 0, peak = 0;
  const flaky = pio({ retryMs: 0, free: async (s) => { calls++; live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 1)); live--; return !(s.path === "img/hero.jpg" && calls === 1); }, hasPhoto: async () => false });
  const out = await pictureDraft({ slots: [hero, { ...hero, path: "img/team.jpg" }] }, "u", "fairway", flaky.v);
  assert.equal(peak, 1);
  assert.match(out, /Made 2 realistic photos/);
  const late = pio({ budgetMs: -1, free: async () => true, hasPhoto: async () => false });
  assert.match(await pictureDraft({ slots: [hero] }, "u", "fairway", late.v), /free generator failed for img\/hero\.jpg/);
});
