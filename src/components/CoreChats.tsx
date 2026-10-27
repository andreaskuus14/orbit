"use client";
// CORE chat list + Projects, like the Claude app sidebar: a sheet over the CORE panel (works the same in the phone layout).
import { useCallback, useEffect, useRef, useState } from "react";
import { useDialogFocus } from "./useDialogFocus";
import { MAX_INSTRUCTIONS, MAX_PROJECT_NAME, MAX_TITLE, type Project } from "@/lib/core-chats-pure";

export type ChatRow = { id: string; title: string; updated_at: string };
type ListResp = { chats: ChatRow[]; projects: Project[]; map: Record<string, string> };

export async function chatsApi<T = Record<string, unknown>>(body?: Record<string, unknown>, query = ""): Promise<T> {
  const res = await fetch(`/api/core/chats${query}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

/** The chat list, projects and chat → project map; `act` runs a POST action, then reloads. */
export function useCoreChats() {
  const [data, setData] = useState<ListResp>({ chats: [], projects: [], map: {} });
  const [error, setError] = useState("");
  const reload = useCallback(() => chatsApi<ListResp>().then((d) => { setData(d); setError(""); }, (e) => setError(e instanceof Error ? e.message : "Couldn't load chats")), []);
  useEffect(() => { void reload(); }, [reload]);
  const act = useCallback(async (body: Record<string, unknown>) => {
    try { const r = await chatsApi(body); setError(""); return r; }
    catch (e) { setError(e instanceof Error ? e.message : "failed"); return null; }
    finally { void reload(); }
  }, [reload]);
  return { ...data, error, reload, act };
}

type Props = ReturnType<typeof useCoreChats> & {
  activeId: string | null; onOpen: (id: string) => void; onNew: (projectId: string | null) => void; onDeleted: (id: string) => void; onClose: () => void;
};

export function ChatSheet({ chats, projects, map, error, act, activeId, onOpen, onNew, onDeleted, onClose }: Props) {
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const navRef = useRef<HTMLElement>(null);
  useDialogFocus(navRef, true, onClose);
  const rename = (c: ChatRow) => {
    const t = prompt("Rename chat", c.title)?.trim();
    if (t && t !== c.title) void act({ action: "rename", id: c.id, title: t.slice(0, MAX_TITLE) });
  };
  const remove = async (c: ChatRow) => {
    if (!confirm(`Delete "${c.title}"? This can't be undone.`)) return;
    if (await act({ action: "delete", id: c.id })) onDeleted(c.id);
  };
  const row = (c: ChatRow) => (
    <li key={c.id} className={`flex items-center gap-1 rounded-lg px-1 ${c.id === activeId ? "bg-white/10" : ""}`}>
      <button type="button" className="min-w-0 flex-1 truncate py-1.5 text-left text-sm" aria-current={c.id === activeId || undefined} title={c.title} onClick={() => onOpen(c.id)}>{c.title}</button>
      <button type="button" className="chip px-2" aria-label={`Rename ${c.title}`} title="Rename" onClick={() => rename(c)}>✎</button>
      <button type="button" className="chip px-2" aria-label={`Delete ${c.title}`} title="Delete" onClick={() => void remove(c)}>✕</button>
    </li>
  );
  const recents = chats.filter((c) => !map[c.id]);
  return (
    <>
      <button type="button" className="chat-sheet-backdrop" aria-label="Close chat list" onClick={onClose} />
      <nav ref={navRef} tabIndex={-1} className="glass chat-sheet" aria-label="CORE chats">
        <div className="mb-2 flex items-center gap-2">
          <button type="button" className="btn flex-1" onClick={() => onNew(null)}>＋ New chat</button>
          <button type="button" className="chip" onClick={onClose} aria-label="Close chat list">Close</button>
        </div>
        {error && <p className="error mb-2" role="alert">{error}</p>}

        <div className="mt-3 flex items-center justify-between"><span className="h3">Projects</span>
          <button type="button" className="chip px-2" aria-label="New project" title="New project" onClick={() => setEditing("new")}>＋</button></div>
        {editing && <ProjectForm project={editing === "new" ? null : editing} onCancel={() => setEditing(null)}
          onSave={async (name, instructions) => { if (await act(editing === "new" ? { action: "addProject", name, instructions } : { action: "updateProject", id: editing.id, name, instructions })) setEditing(null); }} />}
        {!projects.length && !editing && <p className="muted mt-1 text-xs">Group chats with shared instructions and pinned notes.</p>}
        <ul className="mt-1 space-y-1">
          {projects.map((p) => {
            const inside = chats.filter((c) => map[c.id] === p.id);
            return (
              <li key={p.id}>
                <details open={inside.some((c) => c.id === activeId) || undefined}>
                  <summary className="cursor-pointer truncate py-1 text-sm font-semibold">{p.name} <span className="muted font-normal">· {inside.length}</span></summary>
                  <div className="ml-2 border-l border-white/10 pl-2">
                    <div className="my-1 flex flex-wrap gap-1">
                      <button type="button" className="chip" onClick={() => onNew(p.id)}>＋ Chat</button>
                      <button type="button" className="chip" onClick={() => setEditing(p)}>Edit</button>
                      <button type="button" className="chip" onClick={() => { if (confirm(`Delete project "${p.name}" and its pinned notes? Its chats are kept.`)) void act({ action: "deleteProject", id: p.id }); }}>Delete</button>
                    </div>
                    <ul>{inside.map(row)}</ul>
                    {!!p.pins.length && (
                      <details className="mt-1">
                        <summary className="muted cursor-pointer text-xs">📌 Pinned notes ({p.pins.length})</summary>
                        <ul className="mt-1 space-y-1">
                          {[...p.pins].reverse().map((n) => (
                            <li key={n.id} className="rounded-lg bg-white/5 p-1.5 text-xs">
                              <details>
                                <summary className="cursor-pointer truncate">{n.title}</summary>
                                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words">{n.text}</pre>
                              </details>
                              <div className="mt-1 flex gap-1">
                                <button type="button" className="chip" onClick={() => void navigator.clipboard?.writeText(n.text)}>Copy</button>
                                <button type="button" className="chip" onClick={() => { if (confirm(`Unpin "${n.title}"?`)) void act({ action: "unpin", projectId: p.id, id: n.id }); }}>Unpin</button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>

        <div className="h3 mt-4">Recents</div>
        {!recents.length && <p className="muted mt-1 text-xs">No chats yet. They save automatically.</p>}
        <ul className="mt-1">{recents.map(row)}</ul>
      </nav>
    </>
  );
}

function ProjectForm({ project, onSave, onCancel }: { project: Project | null; onSave: (name: string, instructions: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(project?.name ?? "");
  const [ins, setIns] = useState(project?.instructions ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <form className="mt-2 space-y-2 rounded-lg bg-white/5 p-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSave(name, ins); setBusy(false); }}>
      <input className="field w-full" placeholder="Project name" aria-label="Project name" value={name} maxLength={MAX_PROJECT_NAME} onChange={(e) => setName(e.target.value)} autoFocus />
      <textarea className="field w-full" rows={4} placeholder="Instructions for CORE in this project (optional)" aria-label="Project instructions"
        value={ins} maxLength={MAX_INSTRUCTIONS} onChange={(e) => setIns(e.target.value)} />
      <div className="flex items-center gap-2">
        <button className="btn" disabled={busy || !name.trim()}>{project ? "Save" : "Create"}</button>
        <button type="button" className="chip" onClick={onCancel}>Cancel</button>
        <span className="muted ml-auto text-xs">{ins.length}/{MAX_INSTRUCTIONS}</span>
      </div>
    </form>
  );
}
