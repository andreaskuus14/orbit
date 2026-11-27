import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createOrbit2StreamMapper,
  DEFAULT_ORBIT2_CWD,
  DEFAULT_ORBIT2_MODEL,
  formatOrbit2ToolDetail,
  formatOrbit2ToolLabel,
  ORBIT2_SETTING_SOURCES,
  resolveOrbit2Model,
} from "../src/lib/orbit2-pure.ts";
import { isLoopbackHost } from "../src/lib/orbit2-local-pure.ts";

test("ORBIT 2 config defaults and Fable model ban", () => {
  assert.equal(DEFAULT_ORBIT2_CWD, "C:\\Users\\andre\\orbit-config");
  assert.equal(DEFAULT_ORBIT2_MODEL, "opus");
  assert.deepEqual([...ORBIT2_SETTING_SOURCES], ["user", "project"]);
  assert.equal(resolveOrbit2Model(), "opus");
  assert.equal(resolveOrbit2Model("claude-opus-5-5"), "claude-opus-5-5");
  assert.throws(() => resolveOrbit2Model("fable"), /Fable/i);
  assert.throws(() => resolveOrbit2Model("claude-fable-1"), /Fable/i);
});

test("ORBIT 2 tool labels and detail formatting", () => {
  assert.equal(formatOrbit2ToolLabel("mcp__claude_ai_Google_Calendar__list_events"), "Checking Google Calendar…");
  assert.equal(formatOrbit2ToolLabel("Read"), "Reading file…");
  assert.equal(formatOrbit2ToolLabel("ToolSearch"), "Loading tool…");
  assert.equal(
    formatOrbit2ToolDetail("mcp__claude_ai_Google_Calendar__list_events", {
      timeMin: "2026-11-23T00:00:00Z",
      timeMax: "2026-11-29T23:59:59Z",
    }),
    "2026-11-23 → 2026-11-29",
  );
  assert.equal(formatOrbit2ToolDetail("Read", { file_path: "C:\\Users\\andre\\Documents\\orbit\\README.md" }), "C:\\Users\\andre\\Documents\\orbit\\README.md");
});

test("createOrbit2StreamMapper streams live steps, deltas, denials and final answer", () => {
  let t = 1000;
  const mapper = createOrbit2StreamMapper(() => (t += 100));

  const init = mapper.push({ type: "system", subtype: "init", session_id: "sess-1", model: "claude-opus-5-5" });
  assert.equal(init[0]?.type, "start");
  if (init[0]?.type === "start") {
    assert.equal(init[0].sessionId, "sess-1");
    assert.equal(init[0].model, "claude-opus-5-5");
  }

  // Pre-tool chatter gets cleared when tool starts
  const pre = mapper.push({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "Let me check..." } } });
  assert.equal(pre[0]?.type, "delta");

  const startTool = mapper.push({
    type: "stream_event",
    parent_tool_use_id: null,
    event: { type: "content_block_start", content_block: { type: "tool_use", id: "tu_1", name: "Read" } },
  });
  assert.equal(startTool[0]?.type, "reset");
  assert.equal(startTool[1]?.type, "step");

  const enriched = mapper.push({
    type: "assistant",
    parent_tool_use_id: null,
    message: { content: [{ type: "tool_use", id: "tu_1", name: "Read", input: { file_path: "C:\\Users\\andre\\Documents\\orbit\\README.md" } }] },
  });
  assert.equal(enriched[0]?.type, "step");
  if (enriched[0]?.type === "step") {
    assert.equal(enriched[0].id, 1);
    assert.equal(enriched[0].detail, "C:\\Users\\andre\\Documents\\orbit\\README.md");
  }

  const denied = mapper.push({
    type: "user",
    parent_tool_use_id: null,
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "tu_1",
          is_error: true,
          content: "<tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>",
        },
      ],
    },
  });
  assert.equal(denied[0]?.type, "step_done");
  if (denied[0]?.type === "step_done") {
    assert.equal(denied[0].ok, false);
    assert.equal(denied[0].blocked, true);
    assert.equal(denied[0].result, "File is in a directory that is denied by your permission settings.");
  }

  const done = mapper.push({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Blocked by permission settings.",
    permission_denials: [{ tool_name: "Read", tool_use_id: "tu_1" }],
  });
  assert.equal(done[0]?.type, "done");
  if (done[0]?.type === "done") {
    assert.equal(done[0].answer, "Blocked by permission settings.");
    assert.equal(done[0].permissionDenials?.length, 1);
  }
});

test("isLoopbackHost allows local loopback only and refuses cloud mode", () => {
  assert.equal(isLoopbackHost("127.0.0.1:3100"), true);
  assert.equal(isLoopbackHost("localhost:3000"), true);
  assert.equal(isLoopbackHost("[::1]:3100"), true);
  assert.equal(isLoopbackHost("orbit.example.com"), false);
  assert.equal(isLoopbackHost("127.0.0.1:3100", { ORBIT_ROLE: "cloud" }), false);
});
