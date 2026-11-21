// Galaxy scout moon → OPERATIONS → Scout. The panel may not be mounted yet: the request waits in sessionStorage and an event
// covers the case where it already is.
export const SCOUT_CHANGED = "orbit:scout-changed"; // the galaxy re-reads its moon count
export const SCOUT_TAB_EVENT = "orbit:scout-tab";
const KEY = "orbit.opsScout";
export function requestScoutTab() {
  try { sessionStorage.setItem(KEY, "1"); } catch { /* private mode: the event still works */ }
  dispatchEvent(new CustomEvent(SCOUT_TAB_EVENT));
}
/** True once after requestScoutTab (then cleared). */
export function takeScoutTab(): boolean {
  try { const on = sessionStorage.getItem(KEY) === "1"; sessionStorage.removeItem(KEY); return on; } catch { return false; }
}
