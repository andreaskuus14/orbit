// Stable navigation targets (G02/G20): a planet (internal id, so renames like "GAME DEV" never break a link), an optional
// workspace view and an optional record. Lives in the URL hash as "#o=business&v=client&k=client&id=…".
// UI: Orbit.tsx (hash <-> state, Back/refresh), WorkspaceFrame.tsx (view). Tested in tests/deeplink.test.ts.
import { planetById, type PanelId } from "./planets.ts";

export type LinkKind = "task" | "goal" | "memory" | "client" | "review"; // review: a STUDIO production record (production-pure recordId)
export type DeepLink = { planet: PanelId; view?: string; kind?: LinkKind; id?: string };
const KINDS: readonly LinkKind[] = ["task", "goal", "memory", "client", "review"];
const SAFE = /^[\w.:-]{1,80}$/; // ids and view names only: nothing a link could smuggle into a query or the DOM

export function linkToHash(l: DeepLink | null): string {
  if (!l) return "";
  const q = new URLSearchParams({ o: l.planet });
  if (l.view) q.set("v", l.view);
  if (l.kind && l.id) { q.set("k", l.kind); q.set("id", l.id); }
  return `#${q}`;
}

/** null for anything that isn't one of our links (other hashes such as "#r-call" stay untouched). */
export function linkFromHash(hash: string): DeepLink | null {
  if (!hash.startsWith("#o=")) return null;
  const q = new URLSearchParams(hash.slice(1)), planet = q.get("o") ?? "";
  if (planet !== "core" && planet !== "profile" && !planetById(planet)) return null;
  const l: DeepLink = { planet: planet as PanelId };
  const v = q.get("v"), k = q.get("k") as LinkKind | null, id = q.get("id");
  if (v && SAFE.test(v)) l.view = v;
  if (k && KINDS.includes(k) && id && SAFE.test(id)) { l.kind = k; l.id = id; }
  return l;
}

/** The hash with this planet's view replaced (a tab click); unchanged when the hash is about another planet. */
export function withView(hash: string, planet: string, view: string): string {
  const l = linkFromHash(hash);
  return l && l.planet === planet ? linkToHash({ ...l, view }) : hash;
}

/** Back must step out of a record before leaving the world, so opening a record or another planet is a new history
 *  entry; closing a record or switching a tab replaces the current one. */
export const shouldPush = (from: DeepLink | null, to: DeepLink | null) =>
  !!to && (from?.planet !== to.planet || (!!to.id && to.id !== from?.id));
