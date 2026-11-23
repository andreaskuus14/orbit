// A tab opened before a live update still asks for the old build's lazy chunks; after the launcher swaps .next they
// 404 (ChunkLoadError) and the planet boundary shows "This part hit a problem". These rules decide when the page
// reloads itself instead (once, so a really broken chunk can't loop) and when it notices that ORBIT was updated.
// Pure; tests in tests/stale-build.test.ts. src/components/StaleBuildWatch.tsx wires them to the browser.

/** sessionStorage key holding the time (ms) of the last automatic reload. */
export const RELOAD_KEY = "orbit:stale-reload";
/** No second automatic reload within this window: if the chunk still fails after one reload, the boundary shows. */
export const RELOAD_GUARD_MS = 2 * 60_000;
/** While the tab is visible, ask /api/health for the build at most this often (also on focus / becoming visible). */
export const POLL_MS = 5 * 60_000;
/** Focus and visibility events can come in bursts; don't ask again sooner than this. */
export const MIN_CHECK_GAP_MS = 15_000;

const CHUNK_RE = /ChunkLoadError|Loading (?:CSS )?chunk \S+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

/** True for the errors a missing build chunk produces (webpack, and the browsers' native dynamic import messages). */
export function isChunkError(e: unknown): boolean {
  if (e == null) return false;
  if (typeof e === "string") return CHUNK_RE.test(e);
  if (typeof e !== "object") return false;
  const o = e as { name?: unknown; message?: unknown; reason?: unknown; error?: unknown };
  if (o.name === "ChunkLoadError") return true;
  if (typeof o.message === "string" && CHUNK_RE.test(o.message)) return true;
  // An ErrorEvent carries the error; a PromiseRejectionEvent the reason.
  return (o.error !== undefined && o.error !== e && isChunkError(o.error)) || (o.reason !== undefined && o.reason !== e && isChunkError(o.reason));
}

/** May the page reload itself now? `last` is the stored RELOAD_KEY value (null = never). A bad value counts as never. */
export function mayReload(last: string | null, now: number): boolean {
  const t = last == null ? NaN : Number(last);
  if (!Number.isFinite(t) || t > now) return true; // missing, garbage, or a clock that went back
  return now - t >= RELOAD_GUARD_MS;
}

/** The server runs a different build than the one this page loaded. Unknown on either side = no. */
export function buildChanged(pageId: string | null | undefined, serverId: string | null | undefined): boolean {
  return !!pageId && !!serverId && pageId !== serverId;
}

/** Ask the server again? Only while visible, and not again within MIN_CHECK_GAP_MS of the last check. */
export function shouldCheck(lastCheck: number, now: number, visible: boolean): boolean {
  return visible && now - lastCheck >= MIN_CHECK_GAP_MS;
}
