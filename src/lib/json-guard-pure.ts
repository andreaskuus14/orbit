// Error-as-data guard: an endpoint's `{ error }` reply (or a 500 page) must never be stored as if it were the real view.
// Read the body only when the status is ok AND it has the shape the component draws; otherwise null → the kit empty/error state.

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** True when v is an object whose listed keys are all objects (o), arrays (a), booleans (b) or numbers (n). */
export function hasShape(v: unknown, spec: Record<string, "o" | "a" | "b" | "n">): v is Record<string, unknown> {
  if (!isObj(v)) return false;
  for (const [k, t] of Object.entries(spec)) {
    const x = v[k];
    if (t === "o" ? !isObj(x) : t === "a" ? !Array.isArray(x) : t === "b" ? typeof x !== "boolean" : typeof x !== "number") return false;
  }
  return true;
}

/** The parsed body when res.ok and check passes, else null. Never throws. */
export async function okJson<T>(res: { ok: boolean; json: () => Promise<unknown> }, check: (v: unknown) => boolean): Promise<T | null> {
  if (!res.ok) return null;
  try { const j = await res.json(); return check(j) ? (j as T) : null; } catch { return null; }
}

/** The `error` text an error reply carries, for the error line. */
export const errorOf = (v: unknown, fallback: string) => (isObj(v) && typeof v.error === "string" && v.error ? v.error : fallback);

// Shapes of the views the fixed components draw.
export const isPcView = (v: unknown) => hasShape(v, { brain: "o", autostart: "o" });
export const isKaggleView = (v: unknown) => hasShape(v, { on: "b", setup: "o", hoursLeft: "n", offers: "a" });
export const isCalView = (v: unknown) => hasShape(v, { configured: "b", connected: "b" });
export const isTrackView = (v: unknown) => hasShape(v, { stages: "a", tracks: "a" });
export const isServerView = (v: unknown) => hasShape(v, { running: "b" });
export const isMissionCat = (v: unknown) => hasShape(v, { targets: "a", defaults: "a" });
export const isEconomyView = (v: unknown) => isObj(v) && !("error" in v);
export const isHealthView = (v: unknown) => hasShape(v, { running: "b" });
export const isComfyView = (v: unknown) => hasShape(v, { running: "b" });
