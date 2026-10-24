// Dev only: how long from opening a world (or returning to the galaxy) until its canvas draws a frame (see dev-timing).
// Kept free of R3F: Orbit imports markOpen at first load.
export let pending: { name: string; t: number } | null = null;
export function markOpen(name: string) { if (process.env.NODE_ENV === "development") pending = { name, t: performance.now() }; }
export function clearMark() { pending = null; }
