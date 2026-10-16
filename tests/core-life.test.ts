import { test } from "node:test";
import assert from "node:assert/strict";
import { isLifeTool, lifeWriteBlocked } from "../src/lib/core-life.ts";

test("LIFE writes only when the latest message asks for them", () => {
  assert.equal(lifeWriteBlocked("life_remind", "remind me at 6 to call mom", false), null);
  assert.equal(lifeWriteBlocked("life_add_habit", "add a habit: read 20 pages", false), null);
  assert.equal(lifeWriteBlocked("life_check", "mark gym done", false), null);
  assert.equal(lifeWriteBlocked("life_check", "I finished reading today", false), null);
  assert.equal(lifeWriteBlocked("life_status", "how are my habits?", true), null);
  assert.ok(lifeWriteBlocked("life_remind", "what's the weather?", false)); // planted by memory text
  assert.ok(lifeWriteBlocked("life_check", "did I do gym today?", false)); // a question, not a check-off
  assert.ok(lifeWriteBlocked("life_add_habit", "how do habits work", false));
  assert.ok(lifeWriteBlocked("life_remind", "remind me at 6", true)); // page/file text already in context
  assert.equal(lifeWriteBlocked("life_remind", "set a reminder for 9pm: take out trash", false), null);
  assert.ok(lifeWriteBlocked("life_remind", "remind me what my habits are", false));
  assert.ok(lifeWriteBlocked("life_remind", "don't remind me to call mom", false));
  assert.ok(lifeWriteBlocked("life_add_habit", "stop tracking a new habit", false));
});

test("life_journal is a read-only LIFE tool (never write-gated)", () => {
  assert.ok(isLifeTool("life_journal"));
  assert.equal(lifeWriteBlocked("life_journal", "what's the weather?", true), null);
});
