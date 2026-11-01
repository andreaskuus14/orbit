// Project desk metadata stays local. Links are references, never fetched or sent to a model.
export type Reference = { title: string; url: string };
export type Desk = { rev: number; notes: string; references: Reference[] };
export const emptyDesk = (): Desk => ({ rev: 0, notes: "", references: [] });
export const projectId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const archScopeKey = (user: string, project: string | null) => project ? `${user}:${project}` : user;
export const archBrowserKey = (project: string | null) => `orbit.arch.v1${project ? `:${project}` : ""}`;
export const archUrl = (kind: "scene" | "versions", project: string | null) => `/api/arch/${kind}${project ? `?project=${encodeURIComponent(project)}` : ""}`;

/** Strict bounded input; reject unsafe links instead of changing their meaning. */
export function deskInput(raw: unknown): Omit<Desk, "rev"> | string {
  const b = raw as Partial<Desk> | null;
  if (!b || typeof b.notes !== "string" || b.notes.length > 6000 || !Array.isArray(b.references) || b.references.length > 50) return "Use up to 6,000 characters and 50 references";
  const references: Reference[] = [], seen = new Set<string>();
  for (const r of b.references) {
    if (!r || typeof r.title !== "string" || !r.title.trim() || r.title.length > 160 || typeof r.url !== "string" || r.url.length > 2000) return "Give each reference a title and a valid public web link";
    let u: URL;
    try { u = new URL(r.url); } catch { return "That reference is not a valid web link"; }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return "Use http(s) links without embedded login details";
    if (!seen.has(u.href)) { references.push({ title: r.title.trim(), url: u.href }); seen.add(u.href); }
  }
  return { notes: b.notes, references };
}
