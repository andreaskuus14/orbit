// Pointer and panel maths for the motion system: the cursor ring's magnetic pull and the draggable panels' clamp.
// No DOM, so it runs under node --test. Writes into `out` objects: nothing allocates per frame.

type P = { x: number; y: number };

/** Pulls the point (px, py) a fraction `k` of the way toward a target's centre, at most `max` px. Bad input: no pull. */
export function magnet(px: number, py: number, cx: number, cy: number, k: number, max: number, out: P): P {
  let dx = (cx - px) * k, dy = (cy - py) * k;
  const l = Math.hypot(dx, dy);
  if (!Number.isFinite(l)) { dx = 0; dy = 0; }
  else if (l > max) { dx *= max / l; dy *= max / l; }
  out.x = px + dx; out.y = py + dy;
  return out;
}

/** Clamps a dragged panel's offset so its header can always be grabbed again: the top edge stays on screen and at
 *  least `keep` px of the panel stays inside the viewport. box = the panel's natural (un-dragged) rect. */
export function clampDrag(x: number, y: number, box: { left: number; top: number; width: number; height: number }, vw: number, vh: number, keep = 64, out: P = { x: 0, y: 0 }): P {
  const minX = keep - box.left - box.width, maxX = vw - keep - box.left;
  const minY = -box.top, maxY = vh - keep - box.top;
  const c = (v: number, lo: number, hi: number) => (!Number.isFinite(v) || hi < lo ? 0 : Math.min(hi, Math.max(lo, v)));
  out.x = c(x, minX, maxX); out.y = c(y, minY, maxY);
  return out;
}
