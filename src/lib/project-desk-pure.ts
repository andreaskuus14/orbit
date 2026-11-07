// Project desk metadata stays local. Links are references, never fetched or sent to a model.
import { CORE_PROJECT_REQUEST_KEY } from "./core-chats-pure.ts";

const DRAFT_PREFIX = "orbit.project.draft:";
export const deskDraftKey = (project: string) => `${DRAFT_PREFIX}${project}`;
/** Sign-out (and the login page, for expired sessions): drop desk recovery drafts and the pending CORE project request
 *  from this tab, so the next person at the browser can't read them. */
export function clearProjectSession(store: Pick<Storage, "length" | "key" | "removeItem">) {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k && (k.startsWith(DRAFT_PREFIX) || k === CORE_PROJECT_REQUEST_KEY)) keys.push(k); }
  for (const k of keys) store.removeItem(k); // collected first: removing while indexing would skip keys
}
export type Reference = { title: string; url: string };
export type ProjectFile = { id: string; label: string };
export type ProjectClip = { id: string; title: string };
export type Desk = { rev: number; notes: string; references: Reference[]; files?: ProjectFile[]; productions?: ProjectClip[]; palette?: string[] };
export const emptyDesk = (): Desk => ({ rev: 0, notes: "", references: [] });
export type DeskDraft = { desk: Desk; title: string; url: string; request: string };
/** Browser recovery data gets the same link/file validation as an API save. */
export function readDeskDraft(raw: unknown): DeskDraft | null {
  const d = raw as DeskDraft | null;
  if (!d || !d.desk || !Number.isSafeInteger(d.desk.rev) || d.desk.rev < 0 || typeof d.title !== "string" || d.title.length > 160 || typeof d.url !== "string" || d.url.length > 2000 || typeof d.request !== "string" || d.request.length > 8000) return null;
  const input = deskInput(d.desk);
  return typeof input === "string" ? null : { desk: { ...input, rev: d.desk.rev }, title: d.title, url: d.url, request: d.request };
}
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
  if (b.files !== undefined && (!Array.isArray(b.files) || b.files.length > 50 || b.files.some((f) => !f || !projectId(f.id) || typeof f.label !== "string" || !f.label.trim() || f.label.length > 240))) return "Choose up to 50 VAULT files";
  if (b.productions !== undefined && (!Array.isArray(b.productions) || b.productions.length > 50 || b.productions.some((c) => !c || typeof c.id !== "string" || !/^[\w.:-]{1,80}$/.test(c.id) || typeof c.title !== "string" || !c.title.trim() || c.title.length > 200))) return "Choose up to 50 STUDIO clips";
  if (b.palette !== undefined && (!Array.isArray(b.palette) || b.palette.length > 12 || b.palette.some((c) => typeof c !== "string" || !/^#[0-9a-f]{6}$/i.test(c)))) return "Choose up to 12 hex colors";
  return { notes: b.notes, references,
    ...(b.files && { files: b.files.filter((f, i, all) => all.findIndex((x) => x.id === f.id) === i) }),
    ...(b.productions && { productions: b.productions.filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i) }),
    ...(b.palette && { palette: [...new Set(b.palette.map((c) => c.toLowerCase()))] }),
  };
}
