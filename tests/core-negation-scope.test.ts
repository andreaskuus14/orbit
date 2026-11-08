// A "don't" blocks a CORE write only when it's aimed at the write itself, not at a detail of what he asked for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wsWriteBlocked } from "../src/lib/ws-intent-pure.ts";
import { opsBlocked } from "../src/lib/core-operator-pure.ts";
import { lifeWriteBlocked } from "../src/lib/core-life.ts";

const ws = (q: string) => wsWriteBlocked(q, false);
const NOT = "the user said not to; answer instead";

test("workspace: a negated detail no longer blocks the build", () => {
  for (const q of ["Build me a landing page for the bakery, don't use red", "Make a pricing page and never show the old prices",
    "Create a todo app; don't forget dark mode", "make a timer app with a stop button and a cancel button"]) assert.equal(ws(q), null, q);
});

test("workspace: a negation of the build itself still blocks", () => {
  for (const q of ["Don't build it yet", "don’t make anything", "never touch the workspace", "stop building", "cancel the site build",
    "stop", "cancel.", "never mind", "not now", "do not write files"]) assert.equal(ws(q), NOT, q);
});

test("LIFE: a reminder about not doing something is allowed; cancelling the reminder isn't", () => {
  assert.equal(lifeWriteBlocked("life_remind", "remind me to never skip leg day tomorrow", false), null);
  assert.equal(lifeWriteBlocked("life_remind", "remind me tomorrow to stop by the bank", false), null);
  assert.equal(lifeWriteBlocked("life_add_habit", "add a habit: don't snack after 9", false), null);
  assert.equal(lifeWriteBlocked("life_remind", "don't remind me about the bank", false), NOT);
  assert.equal(lifeWriteBlocked("life_add_habit", "never mind, don't add that habit", false), NOT);
});

test("operator: a negated detail doesn't block an asked change; a negated change does", () => {
  assert.notEqual(opsBlocked("vault_rename", "rename report.pdf to final.pdf, don't use spaces", false), NOT);
  assert.equal(opsBlocked("vault_rename", "don't rename report.pdf", false), NOT);
  assert.equal(opsBlocked("automation_pause", "cancel, don't pause anything", false), NOT);
});
