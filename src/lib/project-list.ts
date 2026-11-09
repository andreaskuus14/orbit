// The project list is shared by ARCH, STUDIO and OPERATIONS, and ARCH stays mounted while hidden. Anyone who creates or
// changes a project announces it here; open project desks reload their list instead of waiting for a page reload.
export const PROJECTS_CHANGED = "orbit:projects-changed";
export const notifyProjectsChanged = (target: EventTarget = globalThis) => { target.dispatchEvent(new Event(PROJECTS_CHANGED)); };
/** Loads now and again on every change notice; returns the unsubscribe. */
export function watchProjects(load: () => void, target: EventTarget = globalThis): () => void {
  load();
  target.addEventListener(PROJECTS_CHANGED, load);
  return () => target.removeEventListener(PROJECTS_CHANGED, load);
}
