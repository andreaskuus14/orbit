import { test } from "node:test";
import assert from "node:assert/strict";
import { eventLabel } from "../src/lib/event-label-pure.ts";

test("common activity events get short human labels and their planet icon", () => {
  assert.deepEqual(eventLabel("memory.created"), { label: "Memory saved", icon: "🧠" });
  assert.deepEqual(eventLabel("core.completed"), { label: "CORE replied", icon: "✨" });
  assert.deepEqual(eventLabel("pulse.started"), { label: "Briefing started", icon: "🌐" });
  assert.equal(eventLabel("pulse.completed").label, "Briefing ready");
  assert.equal(eventLabel("agent.failed").label, "Agent failed");
  assert.equal(eventLabel("task.delivered").icon, "⚙️");
});

test("unknown event names remain readable with a known planet or generic icon", () => {
  assert.deepEqual(eventLabel("studio.clip_ready-now"), { label: "Studio clip ready now", icon: "🎬" });
  assert.deepEqual(eventLabel("new_world.job_finished"), { label: "New world job finished", icon: "🪐" });
  assert.deepEqual(eventLabel(""), { label: "Activity", icon: "🪐" });
  assert.equal(eventLabel("  ._-  ").label, "Activity");
});

test("unknown names cannot accidentally resolve Object prototype properties", () => {
  assert.deepEqual(eventLabel("toString"), { label: "ToString", icon: "🪐" });
  assert.deepEqual(eventLabel("__proto__"), { label: "Proto", icon: "🪐" });
});
