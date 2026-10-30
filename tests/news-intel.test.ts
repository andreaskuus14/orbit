import { test } from "node:test";
import assert from "node:assert/strict";
import * as m from "../src/lib/news-intel-pure.ts";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const art = (n: number, title: string, source: string, url: string, summary = "", published_at = `2026-10-30T0${n}:00:00Z`) => ({ id: id(n), title, url, source, summary, published_at });
const WIRE = "The central bank raised its main interest rate by half a point on Thursday, citing persistent inflation in services and wages across the region.";

test("INT01: syndicated copies are one source; originals stay in the event", () => {
  const items = [
    art(1, "Central bank raises rates - AP", "AP", "https://ap.org/a", WIRE),
    art(2, "Central bank raises rates", "Local Daily", "https://local.example/x?utm_source=rss", WIRE),
    art(3, "Bank lifts rates again as inflation bites", "Yahoo", "https://yahoo.example/y", WIRE),
    art(4, "Central bank lifts rates, analysts expect more", "FT", "https://ft.example/z", "Own reporting with different details about the decision and the market reaction from traders in London."),
    art(5, "Volcano erupts in Iceland", "BBC", "https://bbc.example/v"),
  ];
  const ev = m.clusterEvents(items);
  const big = ev.find((g) => g.some((a) => a.id === id(1)))!;
  assert.ok([1, 2, 3].every((n) => big.some((a) => a.id === id(n))), "copies grouped and all kept");
  assert.equal(m.independentSources(items.slice(0, 3)), 1);
  assert.equal(m.independentSources(items.slice(0, 4)), 2);
  assert.equal(ev.find((g) => g.some((a) => a.id === id(5)))!.length, 1);
  assert.equal(m.eventKey(items.slice(0, 3)), "https://ap.org/a");
});

test("INT02: only new or changed developments, never old news as new", () => {
  const ev = [{ key: "a", rev: "1:x", title: "A" }, { key: "b", rev: "2:y", title: "Strike ends after deal" }, { key: "c", rev: "1:z", title: "C update" }];
  assert.deepEqual(m.developments({ a: "1:x", b: "1:old", c: "0:q" }, ev), [{ key: "b", status: "resolved" }, { key: "c", status: "corrected" }]);
  assert.deepEqual(m.developments({}, ev.slice(0, 1)), [{ key: "a", status: "new" }]);
});

test("INT03: fetched passage only on exact URL, snippets labelled, numbers checked", () => {
  assert.equal(m.evidenceOf("https://x.com/a", "https://x.com/a/", "text", "snip").evidence, "fetched");
  assert.equal(m.evidenceOf("https://x.com/a", "https://x.com/b", "text", "snip").evidence, "snippet");
  const cites = [{ id: id(1), url: "u", evidence: "fetched" as const, passage: "It rose 4.5 percent in 2026.", published_at: null }];
  const c = m.checkClaims(`Prices rose 4.5% in 2026 [a:${id(1)}]. Then 9 more [a:${id(1)}]. Ghost [a:${id(2)}].`, cites);
  assert.deepEqual(c.map((x) => x.ok), [true, false, false]);
  assert.match(c[1].what, /9/);
});

test("INT04: prefs clean, exclusions, less-like-this, why-this", () => {
  const p = m.cleanPrefs({ topics: "AI, Roblox", regions: ["Estonia"], projects: ["ORBIT"], exclusions: ["crypto"], length: "x", less: ["celebrity divorce shock"] });
  assert.equal(p.length, "normal"); assert.deepEqual(p.topics, ["AI", "Roblox"]);
  assert.ok(m.excluded("Crypto crash deepens", p));
  assert.ok(m.excluded("Another celebrity divorce stuns fans", p));
  assert.ok(!m.excluded("Estonia budget", p));
  assert.equal(m.whyThis([art(1, "Estonia budget vote", "ERR", "https://err.ee/1")], p), "About your region Estonia; 1 independent source.");
});

test("INT06: story actions need sources; tasks need objective and acceptance", () => {
  const s = { title: "Roblox changes payouts", url: "https://n.example/1", published_at: "2026-10-30T00:00:00Z" };
  assert.match((m.storyPayload({ ...s, kind: "note" }) as { content: string }).content, /n\.example.*2026-10-30/);
  assert.ok("error" in m.storyPayload({ ...s, kind: "task", objective: "Check impact" }));
  const t = m.storyPayload({ ...s, kind: "task", objective: "Check impact", acceptance: "A note lists the payout change" }) as { prompt: string };
  assert.match(t.prompt, /Objective: Check impact\nAcceptance: A note/);
  assert.ok("error" in m.storyPayload({ ...s, url: "javascript:x", kind: "note" }));
});

test("INT07: bounded backoff, reset on success, repaired feed doesn't flood", () => {
  const t0 = Date.parse("2026-10-30T00:00:00Z");
  let h = m.nextHealth(undefined, { ok: true, items: 3 }, t0);
  for (let i = 0; i < 12; i++) h = m.nextHealth(h, { ok: false, kind: "fetch", error: "503" }, t0);
  assert.equal(h.failures, 12);
  assert.equal(Date.parse(h.nextRetry!) - t0, 24 * 3600_000);
  assert.ok(!m.due(h, t0) && m.due(h, t0 + 24 * 3600_000));
  assert.equal(h.lastSuccess, new Date(t0).toISOString(), "last good kept");
  const items = [{ published: "2026-10-29T00:00:00Z" }, { published: "2026-10-30T01:00:00Z" }, { published: null }];
  assert.deepEqual(m.freshAfterRepair(items, h), [items[1]]);
  assert.equal(m.nextHealth(h, { ok: true, items: 0 }, t0).kind, "empty");
});
