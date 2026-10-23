import { test } from "node:test";
import assert from "node:assert/strict";
import { spatialTarget, spatialSound, pingEnvelope, planetPing, droneLevel, SOUND_RANGE, LOWPASS_NEAR_HZ, LOWPASS_FAR_HZ,
  PING_ATTACK_SEC, PING_DURATION_SEC, DRONE_MIN_GAIN, DRONE_MAX_GAIN, type SoundCamera, type SoundTarget } from "../src/lib/spatial-sound-pure.ts";

const camera: SoundCamera = { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);
const valid = (t: SoundTarget) => {
  assert.ok(Object.values(t).every(Number.isFinite));
  assert.ok(t.pan >= -1 && t.pan <= 1); assert.ok(t.gain >= 0 && t.gain <= 1);
  assert.ok(t.lowpassHz >= LOWPASS_FAR_HZ && t.lowpassHz <= LOWPASS_NEAR_HZ);
};

test("left/right symmetry, centred front/back/vertical, and coincident source", () => {
  const right = spatialTarget(camera, { x: 8, y: 0, z: -6 }), left = spatialTarget(camera, { x: -8, y: 0, z: -6 });
  close(right.pan, 0.8); close(left.pan, -0.8);
  close(right.gain, left.gain); close(right.lowpassHz, left.lowpassHz);
  for (const p of [{ x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: 10 }, { x: 0, y: 10, z: 0 }]) assert.equal(spatialTarget(camera, p).pan, 0);
  assert.deepEqual(spatialTarget(camera, camera.position), { pan: 0, gain: 1, lowpassHz: LOWPASS_NEAR_HZ });
});

test("quaternion yaw, pitch and roll use the camera's world-space right axis", () => {
  const s = Math.SQRT1_2;
  const yaw = { ...camera, orientation: { x: 0, y: s, z: 0, w: s } };
  close(spatialTarget(yaw, { x: 0, y: 0, z: -10 }).pan, 1);
  const roll = { ...camera, orientation: { x: 0, y: 0, z: s, w: s } };
  close(spatialTarget(roll, { x: 0, y: 10, z: 0 }).pan, 1);
  const pitch = { ...camera, orientation: { x: s, y: 0, z: 0, w: s } };
  close(spatialTarget(pitch, { x: 10, y: 0, z: 0 }).pan, 1);
  const moved = { ...camera, position: { x: 12, y: -3, z: 7 } };
  assert.deepEqual(spatialTarget(moved, { x: 20, y: -3, z: 1 }), spatialTarget(camera, { x: 8, y: 0, z: -6 }));
  for (const scale of [1e-300, -3, 1e300]) {
    const q = { ...camera, orientation: { x: 0, y: s * scale, z: 0, w: s * scale } };
    close(spatialTarget(q, { x: 0, y: 0, z: -10 }).pan, 1);
  }
});

test("gain and cutoff decrease monotonically with distance, pan stays directional", () => {
  let previous = spatialTarget(camera, camera.position);
  for (const distance of [0.01, 1, SOUND_RANGE, 50, 1000, 1e100, Number.MAX_VALUE]) {
    const next = spatialTarget(camera, { x: distance, y: 0, z: 0 });
    valid(next); assert.equal(next.pan, 1);
    assert.ok(next.gain <= previous.gain); assert.ok(next.lowpassHz <= previous.lowpassHz);
    previous = next;
  }
  assert.equal(spatialTarget(camera, { x: SOUND_RANGE, y: 0, z: 0 }).gain, 0.25);
});

test("all target outputs stay clamped and finite for invalid and extreme inputs", () => {
  const numbers = [0, -1, 1, 1e-300, 1e308, -1e308, NaN, Infinity, -Infinity];
  for (const n of numbers) {
    const p = { x: n, y: n, z: n };
    valid(spatialTarget(camera, p));
    valid(spatialTarget({ ...camera, position: p }, { x: -n, y: -n, z: -n }));
    valid(spatialTarget({ ...camera, orientation: { ...p, w: n } }, { x: 5, y: 3, z: -4 }));
  }
  assert.equal(spatialTarget(camera, { x: NaN, y: 0, z: 0 }).gain, 0);
  assert.deepEqual(spatialTarget({ ...camera, orientation: { x: 0, y: 0, z: 0, w: 0 } }, { x: 1, y: 0, z: 0 }), spatialTarget(camera, { x: 1, y: 0, z: 0 }));
});

test("ping attacks, releases monotonically, ends in silence and keeps its planet's direction", () => {
  for (const t of [-1, 0, PING_DURATION_SEC, 10, NaN, Infinity, -Infinity]) assert.equal(pingEnvelope(t), 0);
  assert.equal(pingEnvelope(PING_ATTACK_SEC), 1);
  close(pingEnvelope(PING_ATTACK_SEC / 2), 0.5);
  let previous = 0;
  for (let i = 0; i <= 20; i++) { const v = pingEnvelope(PING_ATTACK_SEC * i / 20); assert.ok(v >= previous); previous = v; }
  previous = 1;
  for (let i = 1; i <= 100; i++) { const v = pingEnvelope(PING_ATTACK_SEC + (PING_DURATION_SEC - PING_ATTACK_SEC) * i / 100); assert.ok(v <= previous && v >= 0); previous = v; }
  const planet = { id: "garden", position: { x: -5, y: 2, z: -3 } }, target = spatialTarget(camera, planet.position);
  for (const t of [0, 0.01, 0.02, 0.3, 0.6, NaN]) {
    const ping = planetPing(camera, planet, t); valid(ping);
    assert.equal(ping.pan, target.pan); assert.equal(ping.lowpassHz, target.lowpassHz);
    close(ping.gain, target.gain * pingEnvelope(t));
  }
});

test("drone follows breath monotonically with a quiet floor and bounded peak", () => {
  assert.equal(droneLevel(-1), DRONE_MIN_GAIN); close(droneLevel(2), DRONE_MAX_GAIN);
  close(droneLevel(0.5), (DRONE_MIN_GAIN + DRONE_MAX_GAIN) / 2);
  let previous = 0;
  for (let i = 0; i <= 100; i++) { const v = droneLevel(i / 100); assert.ok(v >= previous && v <= DRONE_MAX_GAIN); previous = v; }
  for (const v of [NaN, Infinity, -Infinity]) assert.equal(droneLevel(v), DRONE_MIN_GAIN);
});

test("per-planet targets are repeatable, independent and do not mutate inputs", () => {
  const planets = Object.freeze([Object.freeze({ id: "left", position: Object.freeze({ x: -8, y: 0, z: 0 }) }),
    Object.freeze({ id: "right", position: Object.freeze({ x: 8, y: 0, z: 0 }) }), { id: "__proto__", position: camera.position }]);
  const before = JSON.stringify({ camera, planets }), a = spatialSound(camera, planets), b = spatialSound(camera, planets);
  assert.deepEqual(a, b); assert.equal(a.left.pan, -1); assert.equal(a.right.pan, 1);
  assert.ok(Object.hasOwn(a, "__proto__"));
  a.left.gain = 0; assert.equal(b.left.gain, 0.25);
  assert.equal(JSON.stringify({ camera, planets }), before);
  assert.deepEqual(spatialSound(camera, []), {});
});
