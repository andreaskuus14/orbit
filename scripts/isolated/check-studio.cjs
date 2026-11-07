// Isolated check `studio`: one AI Story Short from idea to a playable export through the real STUDIO UI, with the fake Higgsfield
// (ORBIT_HIGGSFIELD_DRY_RUN=1: no network, no credits) and the fake CLI's script. Narration is local Kokoro (downloads once).
const L = require("./lib.cjs");

const panel = (page, id) => page.locator(`#cf-panel-${id}`);
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, " "); // innerText is uppercased by CSS: match with /i

(async () => {
  const { browser, page } = await L.session();
  const t0 = Date.now(), secs = () => `${Math.round((Date.now() - t0) / 1000)} s`;
  const before = (await L.api(page, "/api/higgsfield")).json?.used ?? 0;
  await L.sleep(12000); await page.keyboard.press("Escape"); // the galaxy settles; close an evening prompt if one opened
  await page.evaluate(() => { location.hash = "o=studio"; }); await L.sleep(6000);
  await L.press(page.getByRole("button", { name: "Clips", exact: true })); await L.sleep(2000);
  await L.press(page.locator("#cf-tab-story")); await L.sleep(1000);
  const P = panel(page, "story");
  await L.press(P.getByRole("button", { name: "Narrated story" }));
  await P.locator("#story-idea").fill(`a lighthouse keeper finds a note in her own handwriting ${L.tag()}`);
  await L.press(P.getByRole("button", { name: /Write story/ }));
  L.ok("studio: the idea becomes a script", !!await L.until(async () => /Get cost/i.test(await text(P)), 120000, 1000), secs());
  await L.press(P.getByRole("button", { name: /Get cost/ }));
  const quote = await L.until(async () => (/Approve & generate \((\d+) credits\)/i.exec(await text(P)) ?? [])[1], 60000, 1000);
  L.ok("studio: the price is shown before anything is generated", !!quote, `${quote} credits (fake), ${secs()}`);
  await L.press(P.getByRole("button", { name: /Approve & generate/ }));
  const end = await L.until(async () => { const s = await text(P); return /Open in Clips to review/i.test(s) ? "done" : /\bFailed\b/i.test(s) ? s.slice(-400) : null; }, 15 * 60000, 3000);
  L.ok("studio: Approve renders the Short into the review queue", end === "done", end === "done" ? secs() : String(end));
  const used = (await L.api(page, "/api/higgsfield")).json?.used ?? 0;
  L.ok("studio: the weekly cap counts exactly the approved quote", used - before === Number(quote), `${before} → ${used}`);
  if (end !== "done") throw new Error("no Short to review");
  await L.press(P.getByRole("button", { name: /Open in Clips/ })); await L.sleep(3000);
  const dl = page.locator('a[href*="/api/studio/clips/media"][href*=".mp4"]').first(); // the clip card's ⬇ Download (under More…)
  await dl.waitFor({ state: "attached", timeout: 30000 });
  const href = await dl.getAttribute("href");
  const file = await page.evaluate(async (u) => { const r = await fetch(u); const b = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, type: r.headers.get("content-type"), size: b.length, ftyp: String.fromCharCode(...b.slice(4, 8)) }; }, href);
  L.ok("studio: Download gives a playable MP4", file.status === 200 && file.type === "video/mp4" && file.ftyp === "ftyp" && file.size > 100000, `${file.status} ${file.type} ${Math.round(file.size / 1024)} KB`);
  await browser.close();
  process.exit(L.failures() ? 1 : 0);
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
