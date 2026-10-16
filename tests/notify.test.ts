import { test } from "node:test";
import assert from "node:assert/strict";
import { addItem, parseItems, unreadCount, relTime, notify, NOTIFY_EVENT, NOTIFY_CAP, type NotifyItem } from "../src/lib/notify-pure.ts";

const T = 1_700_000_000_000;

test("adds newest first, unread", () => {
  const l = addItem(addItem([], { title: "a", kind: "life" }, T, "1"), { title: "b", kind: "studio", nav: { panel: "studio" } }, T + 1, "2");
  assert.deepEqual(l.map((x) => x.id), ["2", "1"]);
  assert.equal(unreadCount(l), 2);
  assert.deepEqual(l[0].nav, { panel: "studio" });
});

test("dedupes identical title+body within 60 s only", () => {
  let l = addItem([], { title: "x", body: "y", kind: "core" }, T, "1");
  l = addItem(l, { title: "x", body: "y", kind: "core" }, T + 59_000, "2");
  assert.equal(l.length, 1);
  l = addItem(l, { title: "x", body: "other", kind: "core" }, T + 59_000, "3");
  assert.equal(l.length, 2);
  l = addItem(l, { title: "x", body: "y", kind: "core" }, T + 61_000, "4");
  assert.equal(l.length, 3);
});

test("caps at 50 and rejects junk", () => {
  let l: NotifyItem[] = [];
  for (let i = 0; i < 60; i++) l = addItem(l, { title: `n${i}`, kind: "system" }, T + i, String(i));
  assert.equal(l.length, NOTIFY_CAP);
  assert.equal(l[0].title, "n59");
  assert.equal(addItem(l, { title: "", kind: "system" }, T).length, NOTIFY_CAP);
  assert.equal(addItem([], { title: "z", kind: "bogus" as never }, T).length, 0);
});

test("parseItems survives garbage", () => {
  assert.deepEqual(parseItems(null), []);
  assert.deepEqual(parseItems("{bad"), []);
  assert.deepEqual(parseItems('{"a":1}'), []);
  const ok = addItem([], { title: "a", kind: "life" }, T, "1");
  assert.deepEqual(parseItems(JSON.stringify([...ok, { id: 2 }, null])), JSON.parse(JSON.stringify(ok)));
});

test("relTime", () => {
  assert.equal(relTime(T, T + 5_000), "just now");
  assert.equal(relTime(T, T + 5 * 60_000), "5 minutes ago");
  assert.equal(relTime(T, T + 2 * 3600_000), "2 hours ago");
});

test("notify dispatches on globalThis (window in the browser), no-op without it", () => {
  notify({ title: "nobody listening", kind: "system" }); // Node has no global dispatchEvent: must not throw
  const bus = new EventTarget(), g = globalThis as { dispatchEvent?: unknown };
  let got: unknown;
  bus.addEventListener(NOTIFY_EVENT, (e) => { got = (e as CustomEvent).detail; });
  g.dispatchEvent = bus.dispatchEvent.bind(bus);
  try { notify({ title: "hi", kind: "agents" }); } finally { delete g.dispatchEvent; }
  assert.deepEqual(got, { title: "hi", kind: "agents" });
});
