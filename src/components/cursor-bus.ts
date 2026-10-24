// Shared per-frame state between the galaxy canvas and the DOM cursor ring (no React, no events, no allocations).
// The galaxy writes the hovered planet's screen position each frame; the ring ignores it once it goes stale.
export const cursorTarget = { at: 0, label: "", script: false, x: 0, y: 0, r: 0 }; // at = performance.now() of the last write; script: the planet's own label is visible
