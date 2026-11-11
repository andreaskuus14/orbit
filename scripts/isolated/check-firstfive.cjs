// W06: the phone's first five minutes (README.md here). At 320, 390 and 430 px (touch, reduced motion) and once with text zoomed
// to 130 %: home → the briefing (INTELLIGENCE) → Needs you → the pending decision → its source task with Approve / Reject. At every
// step nothing pushes the page sideways and the next control is on screen and tappable. Screenshots: <DIR>/shots/first5-*.png.
// Browser emulation only: a real iPhone check is separate evidence.
const L = require("./lib.cjs");
const fs = require("node:fs");
const path = require("node:path");

const SHOTS = path.join(L.DIR, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const RUNS = [[320, 640, 100], [390, 844, 100], [430, 932, 100], [390, 844, 130]];

// sideways overflow in px, and whether a control is inside the viewport and is the element a tap at its centre would hit
const sideways = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const tappable = (loc) => loc.evaluate((el) => {
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  return r.width > 0 && r.left >= 0 && r.right <= innerWidth && (hit === el || el.contains(hit)) && r.height >= 24;
}).catch(() => false);

(async () => {
  const { browser, page: first } = await L.session();
  const t = L.tag();
  const id = await L.makeTask(first, `First five ${t}`, "[propose:create_project] first five minutes decision");
  L.ok("setup: a decision waits for the owner", !!await L.until(() => L.task(id).status === "awaiting_approval", 30000), L.task(id).status);
  const ctx = first.context(), state = await ctx.storageState();
  await first.close();

  for (const [w, h, zoom] of RUNS) {
    const tagW = `${w}px${zoom !== 100 ? ` text ${zoom}%` : ""}`, shot = (s) => path.join(SHOTS, `first5-${w}${zoom !== 100 ? `-z${zoom}` : ""}-${s}.png`);
    const c = await browser.newContext({ storageState: state, viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: "reduce" });
    const p = await c.newPage();
    if (zoom !== 100) await p.addInitScript((z) => document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.fontSize = `${z}%`; }), zoom);
    const closeDialogs = () => p.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));

    await p.goto(L.BASE + "/"); await L.sleep(6000); await closeDialogs();
    await p.screenshot({ path: shot("1-home") });
    L.ok(`${tagW}: home has no sideways scroll`, (await sideways(p)) <= 0, `${await sideways(p)} px`);

    await p.goto(L.BASE + "/#o=intelligence"); await L.sleep(4000); await closeDialogs();
    await p.screenshot({ path: shot("2-briefing") });
    const brief = await p.getByRole("button", { name: /world brief/i }).first().isVisible().catch(() => false);
    L.ok(`${tagW}: the briefing planet opens without sideways scroll`, brief && (await sideways(p)) <= 0, `visible=${brief}, ${await sideways(p)} px`);

    await p.goto(L.BASE + "/"); await L.sleep(5000); await closeDialogs();
    // phones show the decision straight on home (Continue my work); otherwise it's behind the Needs you chip
    const chip = p.locator(".needs-you-chip");
    if (!(await p.getByRole("button", { name: new RegExp(`First five ${t}`) }).count()) && (await chip.count())) await chip.first().tap();
    const item = p.getByRole("button", { name: new RegExp(`First five ${t}`) }).first();
    await L.until(async () => (await item.count()) > 0, 20000);
    await p.screenshot({ path: shot("3-needs-you") });
    const itemOk = await tappable(item);
    L.ok(`${tagW}: the pending decision is listed and tappable`, itemOk && (await sideways(p)) <= 0, `${await sideways(p)} px`);
    if (itemOk) await item.tap();

    const approve = p.getByRole("button", { name: /^approve/i }).first();
    await L.until(async () => (await approve.count()) > 0, 20000);
    await p.screenshot({ path: shot("4-source") });
    const reject = p.getByRole("button", { name: /^reject/i }).first();
    L.ok(`${tagW}: the source task shows Approve and Reject, both tappable`, (await tappable(approve)) && (await tappable(reject)) && (await sideways(p)) <= 0, `${await sideways(p)} px`);
    await c.close();
  }
  L.ok("decision untouched: viewing on a phone never approved it", L.task(id).status === "awaiting_approval", L.task(id).status);
  await browser.close();
  process.exit(L.failures() ? 1 : 0);
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
