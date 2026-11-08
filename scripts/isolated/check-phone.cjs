// Phone top bar: on the signed-in home, every top-bar control fits on screen and can be tapped at phone widths (320–412 px),
// nothing pushes the page sideways, and ⋯ holds the controls that left the bar (Work, Galaxy) plus Sign out. Desktop keeps them in
// the bar. Screenshots: <DIR>/shots/phone-*.png.
const L = require("./lib.cjs");
const fs = require("node:fs");
const path = require("node:path");

const SHOTS = path.join(L.DIR, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const PHONE = { isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: "reduce" };
const SIZES = [[320, 640], [360, 780], [390, 844], [412, 915]];
const LANDSCAPE = [[640, 360], [667, 375], [844, 390], [915, 412]];

// Header controls: on screen and not covered (the element at the centre is the control itself, or inside it).
const header = (page) => page.evaluate(() => {
  const h = document.querySelector("main > header"), shell = h.parentElement;
  const ctl = [...h.querySelectorAll("button, a")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  return {
    width: innerWidth, sideways: Math.max(shell.scrollLeft, document.scrollingElement.scrollLeft, h.scrollWidth - h.clientWidth),
    off: ctl.filter((e) => { const r = e.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth + 0.5; }).map((e) => (e.getAttribute("aria-label") || e.textContent).trim().slice(0, 20)),
    covered: ctl.filter((e) => { const r = e.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !at || !(e === at || e.contains(at)); })
      .map((e) => (e.getAttribute("aria-label") || e.textContent).trim().slice(0, 20)),
    // a corner badge (absolutely positioned, like the unread count on 🔔) overhangs on purpose: only in-flow content counts as a spill
    spills: ctl.filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === "visible" && ![...e.children].some((c) => getComputedStyle(c).position === "absolute")).map((e) => (e.getAttribute("aria-label") || e.textContent).trim().slice(0, 20)),
    small: ctl.filter((e) => { const r = e.getBoundingClientRect(); return r.height < 40 || r.width < 40; }).map((e) => (e.getAttribute("aria-label") || e.textContent).trim().slice(0, 20)),
    bar: ctl.map((e) => (e.getAttribute("aria-label") || e.textContent).trim()),
  };
});
const shell = (page) => page.evaluate(() => document.querySelector("main > header").parentElement.scrollLeft + document.scrollingElement.scrollLeft);
// The evening "Today in a minute" card can open over the home on a fresh account; it isn't what this check is about.
const clear = async (page) => { await page.waitForTimeout(4000); await page.keyboard.press("Escape"); await page.waitForTimeout(400); };

// Sign out is the menu's last item: on a short screen the menu itself scrolls, so scroll it into view and check it's fully visible.
const signOutReachable = async (page) => {
  const so = page.locator("#hud-menu").getByRole("button", { name: /^(Sign out|Logi välja)$/ });
  await so.scrollIntoViewIfNeeded().catch(() => {});
  return so.evaluate((b) => { const r = b.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return r.top >= 0 && r.bottom <= innerHeight && document.scrollingElement.scrollTop === 0 && !!at && (at === b || b.contains(at)); }).catch(() => false);
};

(async () => {
  for (const [w, h] of SIZES) {
    const tag = `${w}px`;
    const { browser, page } = await L.session({ ...PHONE, viewport: { width: w, height: h } });
    await clear(page);
    const hd = await header(page);
    await page.screenshot({ path: path.join(SHOTS, `phone-${w}.png`) });
    L.ok(`phone ${tag}: nothing pushes the page sideways`, hd.sideways <= 0, `${hd.sideways}px`);
    const alert = hd.bar.some((b) => b.startsWith("Red alert")); // a red alert pill is the widest thing the bar can hold
    L.ok(`phone ${tag}: every top-bar control is on screen${alert ? " (with a red alert showing)" : ""}`, !hd.off.length, hd.off.join(", "));
    L.ok(`phone ${tag}: no top-bar control is covered`, !hd.covered.length, hd.covered.join(", "));
    L.ok(`phone ${tag}: no label spills out of its button`, !hd.spills.length, hd.spills.join(", "));
    L.ok(`phone ${tag}: top-bar controls are finger-sized (≥ 40 px)`, !hd.small.length, hd.small.join(", "));
    L.ok(`phone ${tag}: the home button is there`, hd.bar.includes("Orbital home"), hd.bar.join(" | "));
    L.ok(`phone ${tag}: Work and Galaxy left the bar`, !hd.bar.some((b) => /^(Work|Galaxy|Index)$/.test(b)), hd.bar.join(" | "));

    await page.getByRole("button", { name: "More options" }).tap();
    const menu = page.locator("#hud-menu");
    await menu.waitFor({ state: "visible", timeout: 5000 });
    const items = await menu.evaluate((m) => [...m.querySelectorAll("button")].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map((b) => ({ t: b.textContent.trim(), in: b.getBoundingClientRect().left >= 0 && b.getBoundingClientRect().right <= innerWidth + 0.5 })));
    await page.screenshot({ path: path.join(SHOTS, `phone-${w}-menu.png`) });
    const has = (re) => items.some((i) => re.test(i.t) && i.in);
    L.ok(`phone ${tag}: ⋯ opens without moving the page`, (await shell(page)) === 0);
    L.ok(`phone ${tag}: ⋯ holds Work, Galaxy and Sign out, all on screen`, has(/^Work$/) && has(/^(Galaxy|Index)$/) && has(/^Sign out$/), items.map((i) => i.t).join(" | "));

    L.ok(`phone ${tag}: Sign out can be scrolled to inside ⋯ and is then on screen`, await signOutReachable(page));
    if (w === 390) { // the moved controls still work
      await menu.getByRole("button", { name: "Work", exact: true }).tap();
      L.ok("phone 390px: Work from ⋯ opens the Work sheet", await page.getByRole("complementary", { name: "Work" }).isVisible().catch(() => false));
      await page.keyboard.press("Escape");
    }
    await browser.close();
  }

  for (const [w, h] of LANDSCAPE) {
    const tag = `landscape ${w}×${h}`;
    const { browser, page } = await L.session({ ...PHONE, viewport: { width: w, height: h } });
    await clear(page);
    const hd = await header(page);
    L.ok(`${tag}: every top-bar control is on screen, nothing shifts sideways`, !hd.off.length && hd.sideways <= 0, hd.off.join(", "));
    await page.getByRole("button", { name: "More options" }).tap();
    await page.locator("#hud-menu").waitFor({ state: "visible", timeout: 5000 });
    L.ok(`${tag}: Sign out can be scrolled to inside ⋯ and is then on screen`, await signOutReachable(page));
    await page.screenshot({ path: path.join(SHOTS, `landscape-${w}-menu.png`) });
    await browser.close();
  }

  const { browser, page } = await L.session({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await clear(page);
  const hd = await header(page);
  await page.screenshot({ path: path.join(SHOTS, "desktop-1440.png") });
  L.ok("desktop: Work and Galaxy stay in the top bar", hd.bar.includes("Work") && hd.bar.some((b) => /^(Galaxy|Index)$/.test(b)), hd.bar.join(" | "));
  L.ok("desktop: every top-bar control is on screen", !hd.off.length && hd.sideways <= 0, hd.off.join(", "));
  await page.getByRole("button", { name: "More options" }).click();
  const dup = await page.locator("#hud-menu .hud-menu-phone").evaluateAll((bs) => bs.filter((b) => b.getBoundingClientRect().height > 0).length);
  L.ok("desktop: ⋯ doesn't repeat Work and Galaxy", dup === 0, `${dup} shown`);
  await browser.close();
  process.exit(L.failures() ? 1 : 0);
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
