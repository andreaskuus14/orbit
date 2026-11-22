import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleCorePrompt, pickContextBudget, softTimeout } from "../src/lib/core-context-pure.ts";

test("pickContextBudget assigns quick, normal, and deep tiers cleanly", () => {
  const q = pickContextBudget("hi, what's up?");
  assert.equal(q.tier, "quick");
  assert.equal(q.skipHeavySideContext, true);
  assert.equal(q.topMemoryChars, 1600);

  // Memory-heavy short questions stay normal so history/diary aren't skipped
  const mem = pickContextBudget("what did I write yesterday?");
  assert.equal(mem.tier, "normal");
  assert.equal(mem.skipHeavySideContext, false);

  // Deep tier or attachments get full budget
  const deep = pickContextBudget("short", { deep: true });
  assert.equal(deep.tier, "deep");
  assert.equal(deep.topMemoryChars, 6000);

  const attached = pickContextBudget("check this", { hasAttachment: true });
  assert.equal(attached.tier, "deep");
});

test("softTimeout returns fallback when a lookup is slow and resolves value when fast", async () => {
  const fast = await softTimeout(Promise.resolve("ok"), 100, "fallback");
  assert.equal(fast, "ok");

  const slow = await softTimeout(new Promise<string>((r) => setTimeout(() => r("late"), 200)), 20, "fallback");
  assert.equal(slow, "fallback");

  const err = await softTimeout(Promise.reject(new Error("boom")), 100, "safe");
  assert.equal(err, "safe");
});

test("assembleCorePrompt places stable blocks before dynamic NOW: and USER: for prefix caching", () => {
  const out = assembleCorePrompt({
    now: "2026-11-22 19:30",
    memories: "<memory>M1</memory>",
    chats: "",
    known: "FACT1",
    world: "GOAL1",
    people: "",
    live: "",
    hint: "",
    controlHints: "",
    style: "STYLE1\n\n",
    project: "",
    transcript: "User: prev\nCORE: ok",
    attachBlock: "",
    caps: "",
    moduleTools: "TOOLS1",
    ongoing: true,
    question: "hello",
  });
  const iWorld = out.indexOf("WORLD MODEL");
  const iMem = out.indexOf("MEMORIES:");
  const iNow = out.indexOf("NOW: 2026-11-22 19:30");
  const iUser = out.indexOf("USER: hello");
  assert.ok(iWorld >= 0 && iMem > iWorld);
  assert.ok(iNow > iMem, "NOW: must come after stable prefix blocks");
  assert.ok(iUser > iNow, "USER: must come at the end");
});
