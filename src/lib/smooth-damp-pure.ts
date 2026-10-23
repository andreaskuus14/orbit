// Critically damped easing (the "SmoothDamp" spring): starts from the current velocity and settles without overshoot,
// so a camera that is re-targeted mid-flight curves smoothly instead of jerking. No allocation; non-finite input is ignored.

type V3 = { x: number; y: number; z: number };

/** The house glide (unseen.co-style): closes 1 - exp(-dt/tau) of the gap each frame, so it keeps exp(-dt/tau) of the
 *  remaining distance (tau 0.135 s keeps ~0.884 per 60 fps frame). Same curve at any frame rate; never overshoots. */
export function expDamp(cur: number, target: number, tau: number, dt: number): number {
  if (!Number.isFinite(target)) return Number.isFinite(cur) ? cur : 0;
  if (!Number.isFinite(cur) || !(tau > 0)) return target;
  if (!(dt > 0)) return cur;
  return target + (cur - target) * Math.exp(-dt / tau);
}

/** One step toward `goal`. `vel` holds the velocity between frames (`vel.v`); `time` is roughly the time to arrive (s). */
export function smoothDamp(cur: number, goal: number, vel: { v: number }, time: number, dt: number): number {
  if (!Number.isFinite(cur) || !Number.isFinite(goal)) { vel.v = 0; return Number.isFinite(goal) ? goal : cur; }
  if (!(dt > 0)) return cur;
  if (!Number.isFinite(vel.v)) vel.v = 0;
  const w = 2 / Math.max(time, 1e-4), x = w * dt, k = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - goal, temp = (vel.v + w * change) * dt;
  vel.v = (vel.v - w * temp) * k;
  let out = goal + (change + temp) * k;
  if ((goal - cur > 0) === (out > goal)) { out = goal; vel.v = 0; } // never overshoot
  return out;
}

const vx = { v: 0 }, vy = { v: 0 }, vz = { v: 0 };
/** smoothDamp per component: moves `cur` toward `goal` in place, velocity kept in `vel`. */
export function smoothDampVec<T extends V3>(cur: T, goal: V3, vel: V3, time: number, dt: number): T {
  vx.v = vel.x; vy.v = vel.y; vz.v = vel.z;
  cur.x = smoothDamp(cur.x, goal.x, vx, time, dt); cur.y = smoothDamp(cur.y, goal.y, vy, time, dt); cur.z = smoothDamp(cur.z, goal.z, vz, time, dt);
  vel.x = vx.v; vel.y = vy.v; vel.z = vz.v;
  return cur;
}
