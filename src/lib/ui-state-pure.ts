// Shared UI state rules (G04/G05). Component: components/StateNote.tsx; tabs: components/WorkspaceFrame.tsx.
export type UiState = "loading" | "empty" | "partial" | "stale" | "offline" | "blocked" | "saving" | "saved" | "failed";

export const SPIN_LIMIT_MS = 20_000;

/** A spinner never spins forever: loading/saving past the limit becomes failed. */
export const settle = (s: UiState, startedAt: number, now: number, limit = SPIN_LIMIT_MS): UiState =>
  (s === "loading" || s === "saving") && now - startedAt >= limit ? "failed" : s;

/** Missing data is not zero: null/undefined/NaN show a dash, a real 0 shows 0. */
export const shown = (v: number | null | undefined, fmt: (n: number) => string = String): string =>
  v == null || Number.isNaN(v) ? "—" : fmt(v);

/** ARIA tabs keyboard: arrows wrap, Home/End jump; null = not a tab key. */
export function nextTab(key: string, i: number, n: number): number | null {
  if (n < 1) return null;
  if (key === "ArrowRight") return (i + 1) % n;
  if (key === "ArrowLeft") return (i - 1 + n) % n;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  return null;
}

/** Tabs with a "More" menu: primary views stay in the row, secondary ones go in the menu. The open view always shows in the
 *  row (so the tab panel keeps its label and he sees where he is), even when it is a secondary one. */
export function splitTabs<V extends { id: string; secondary?: boolean }>(views: readonly V[], current: string): { row: V[]; more: V[] } {
  const row = views.filter((v) => !v.secondary || v.id === current);
  return { row, more: views.filter((v) => v.secondary && v.id !== current) };
}
