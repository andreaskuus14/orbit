import { test } from "node:test";
import assert from "node:assert/strict";
import { AUDIO_IDLE, CUE_UNDER_MEDIA, DUCK, holdAnnouncement, targetGains, verifiedCompletion } from "../src/lib/audio-policy-pure.ts";
import { admit, COALESCE_START, cueFor } from "../src/lib/ambient-sound-pure.ts";

test("priority: voice > media > cues > ambience", () => {
  assert.deepEqual(targetGains(AUDIO_IDLE), { ambience: 1, cues: 1 });
  assert.deepEqual(targetGains({ ...AUDIO_IDLE, mic: true }), { ambience: DUCK, cues: DUCK });
  assert.deepEqual(targetGains({ ...AUDIO_IDLE, speaking: true }), { ambience: DUCK, cues: DUCK });
  assert.deepEqual(targetGains({ ...AUDIO_IDLE, media: true }), { ambience: 0, cues: CUE_UNDER_MEDIA });
  assert.deepEqual(targetGains({ ...AUDIO_IDLE, media: true, mic: true }), { ambience: 0, cues: DUCK });
  assert.deepEqual(targetGains({ mic: true, speaking: true, media: true, muted: true }), { ambience: 0, cues: 0 });
});

test("non-urgent announcements wait for THEATER or mute; urgent ones don't", () => {
  assert.equal(holdAnnouncement(AUDIO_IDLE, false), false);
  assert.equal(holdAnnouncement({ ...AUDIO_IDLE, media: true }, false), true);
  assert.equal(holdAnnouncement({ ...AUDIO_IDLE, media: true }, true), false);
  assert.equal(holdAnnouncement({ ...AUDIO_IDLE, muted: true }, false), true);
});

test("completion cue only for a saved done task", () => {
  assert.equal(verifiedCompletion("agent.completed", { status: "done" }), true);
  for (const status of ["awaiting_approval", "failed", "cancelled", undefined]) assert.equal(verifiedCompletion("agent.completed", { status }), false);
  assert.equal(verifiedCompletion("core.completed", { status: "done" }), false);
  assert.equal(cueFor("agent.completed", { status: "awaiting_approval" }), null);
});

test("a burst of completions is one cue", () => {
  let s = COALESCE_START, plays = 0;
  for (let i = 0; i < 10; i++) { const r = admit(s, { source: "agents", kind: "chime" }, 1000 + i * 100); s = r.state; plays += +r.play; }
  assert.equal(plays, 1);
});
