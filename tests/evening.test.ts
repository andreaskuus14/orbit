import { test } from "node:test";
import assert from "node:assert/strict";
import { ENTRY_MAX, eveningDue, journalEntry } from "../src/lib/evening-pure.ts";

const at = (h: number, m = 0) => new Date(2026, 9, 24, h, m);

test("eveningDue: from the 19:00 evening briefing, once per local day", () => {
  assert.equal(eveningDue(at(18, 59), null), false);
  assert.equal(eveningDue(at(19, 0), null), true);
  assert.equal(eveningDue(at(23, 30), "2026-10-23"), true);
  assert.equal(eveningDue(at(21), "2026-10-24"), false);
  assert.equal(eveningDue(at(2), "2026-10-23"), false); // after midnight it waits for tonight
});

test("journalEntry: trims, rejects empty and too long, the title carries only the date", () => {
  assert.deepEqual(journalEntry("  Shipped the pet sim fix.\r\nI prefer mornings for coding.  ", at(20)),
    { title: "Today in a minute · 2026-10-24", content: "Shipped the pet sim fix.\nI prefer mornings for coding." });
  assert.ok("error" in journalEntry("   ", at(20)));
  assert.ok("error" in journalEntry(42, at(20)));
  assert.ok("error" in journalEntry("x".repeat(ENTRY_MAX + 1), at(20)));
  assert.ok("title" in journalEntry("x".repeat(ENTRY_MAX), at(20)));
});
