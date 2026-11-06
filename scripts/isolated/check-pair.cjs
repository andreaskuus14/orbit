// Phone pairing: a failed attempt (wrong code, or a right code whose device can't be saved) must not use up a valid code.
const L = require("./lib.cjs");
const fs = require("node:fs");
const path = require("node:path");
const phone = (code) => fetch(`${L.BASE}/api/remote/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "Test phone" }) })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

(async () => {
  const { browser, page } = await L.session();
  const code = (await L.api(page, "/api/remote/owner", { action: "pair" })).json?.pair?.code;
  L.ok("pair: the PC shows a 6-digit code", /^\d{6}$/.test(String(code)));
  const wrong = await phone(code === "000000" ? "000001" : "000000");
  L.ok("pair: a wrong code is refused", wrong.status === 401, JSON.stringify(wrong.json));
  const f = path.join(L.DIR, "data/remote-devices.json"), had = fs.existsSync(f) ? fs.readFileSync(f) : null;
  if (had) fs.rmSync(f);
  fs.mkdirSync(f); // an unreadable devices file (what a Windows lock looks like): the save fails
  const failed = await phone(code);
  fs.rmdirSync(f); if (had) fs.writeFileSync(f, had);
  L.ok("pair: the right code is refused while the device can't be saved, and says the code still works", !failed.json?.ok && /still works/i.test(JSON.stringify(failed.json)), `${failed.status} ${JSON.stringify(failed.json).slice(0, 110)}`);
  const again = await phone(code);
  L.ok("pair: the same code then pairs", again.json?.ok === true, `${again.status}`);
  const twice = await phone(code);
  L.ok("pair: a used code can't pair a second phone", twice.status === 401, JSON.stringify(twice.json));
  await browser.close();
  process.exit(L.failures() ? 1 : 0);
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
