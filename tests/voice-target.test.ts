import { test } from "node:test";
import assert from "node:assert/strict";
import { contextLine, currentTarget, parseIntent, parseWhen, resolve, safeLink, spokenNumber, spokenOrdinal, yesNo, type Rec } from "../src/lib/voice-target-pure.ts";

const recs: Rec[] = [
  { kind: "client", id: "c1", name: "Kask OÜ", planet: "business" },
  { kind: "client", id: "c2", name: "Tamm Ehitus", planet: "business" },
  { kind: "client", id: "c3", name: "Kask Design", planet: "business" },
];

test("intents in English and Estonian", () => {
  assert.deepEqual(parseIntent("Orbit, summarize this"), { act: "summarize" });
  assert.deepEqual(parseIntent("tee kokkuvõte"), { act: "summarize" });
  assert.deepEqual(parseIntent("open the overdue ones"), { act: "overdue" });
  assert.deepEqual(parseIntent("ava hilinenud"), { act: "overdue" });
  assert.deepEqual(parseIntent("save this version"), { act: "save" });
  assert.deepEqual(parseIntent("salvesta see versioon"), { act: "save" });
  assert.deepEqual(parseIntent("open client Tamm"), { act: "open", kind: "client", name: "tamm" });
  assert.deepEqual(parseIntent("ava klient Tamm"), { act: "open", kind: "client", name: "tamm" });
  assert.deepEqual(parseIntent("open the client"), { act: "open", kind: "client", name: "" });
  assert.equal(parseIntent("open studio"), null);
  assert.equal(parseIntent("what's the weather"), null);
});

test("names resolve exactly; several matches ask", () => {
  assert.deepEqual(resolve({ kind: "client", name: "tamm" }, recs, null), { status: "one", rec: recs[1] });
  assert.equal(resolve({ kind: "client", name: "kask" }, recs, null).status, "many");
  assert.deepEqual(resolve({ kind: "client", name: "kask design" }, recs, null), { status: "one", rec: recs[2] });
});

test("misheard name cannot modify another project", () => {
  assert.deepEqual(resolve({ kind: "client", name: "tam" }, recs, null), { status: "none" }); // no nearest-name guess
  assert.deepEqual(resolve({ kind: "client", name: "kast" }, recs, null), { status: "none" });
  // A change targets only the selected record of the deep link, whatever was said.
  assert.deepEqual(currentTarget({ planet: "business", kind: "client", id: "c2" }), { kind: "client", id: "c2" });
  assert.equal(currentTarget({ planet: "business" }), null);
});

test("bare reference: the one on screen, else ask when several", () => {
  assert.deepEqual(resolve({ kind: "client", name: "" }, recs, { planet: "business", kind: "client", id: "c3" }), { status: "one", rec: recs[2] });
  assert.equal(resolve({ kind: "client", name: "" }, recs, { planet: "business" }).status, "many");
  assert.equal(resolve({ kind: "task", name: "" }, recs, null).status, "none");
});

test("CORE context from a re-validated deep link only", () => {
  assert.match(contextLine(safeLink({ planet: "business", view: "client", kind: "client", id: "c1" })), /planet business, view client, selected client c1/);
  assert.equal(safeLink({ planet: "nope" }), null);
  assert.deepEqual(safeLink({ planet: "business", kind: "client", id: "<x>" }), { planet: "business" });
  assert.equal(contextLine(safeLink("junk")), "");
});

test("Estonian and English dates", () => {
  const now = new Date(2026, 9, 30, 15, 0); // Friday 30 Oct 2026, 15:00
  assert.deepEqual(parseWhen("homme kell 9", now), new Date(2026, 9, 31, 9, 0));
  assert.deepEqual(parseWhen("kolmapäeval", now), new Date(2026, 10, 4, 9, 0));
  assert.deepEqual(parseWhen("ülehomme kell 14.30", now), new Date(2026, 10, 1, 14, 30));
  assert.deepEqual(parseWhen("tomorrow at 7 pm", now), new Date(2026, 9, 31, 19, 0));
  assert.deepEqual(parseWhen("reedel kell kümme", now), new Date(2026, 10, 6, 10, 0)); // next Friday, not today
  assert.deepEqual(parseWhen("kell 9", now), new Date(2026, 9, 31, 9, 0)); // already past today
  assert.equal(parseWhen("some day", now), null);
});

test("numbers, ordinals, yes/no", () => {
  assert.equal(spokenNumber("üheksa"), 9);
  assert.equal(spokenNumber("12"), 12);
  assert.equal(spokenOrdinal("the second one", 3), 2);
  assert.equal(spokenOrdinal("kolmas", 3), 3);
  assert.equal(spokenOrdinal("3.", 3), 3);
  assert.equal(spokenOrdinal("viimane", 4), 4);
  assert.equal(spokenOrdinal("neljas", 3), null);
  assert.equal(yesNo("jah"), true);
  assert.equal(yesNo("ei"), false);
  assert.equal(yesNo("open client Tamm"), null);
});
