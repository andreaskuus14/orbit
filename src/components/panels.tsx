"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { numberCitations } from "@/lib/pure";
import { KINDS, type Kind } from "@/lib/kinds";
import { planetById, type PlanetId } from "@/lib/planets";
import { Markdown } from "./AgentsPanels";

type Memory = { id: string; kind: Kind; title: string; content: string; url: string | null; storage_path: string | null; tags: string[]; created_at: string; updated_at: string; source: string };
type Cite = { id: string; title: string; kind: string };
type Step = { step: string; detail: string; ms: number; ok: boolean };
type Msg = { role: "user" | "assistant"; content: string; citations?: Cite[]; trace?: Step[]; error?: boolean };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

/* ---------------- CORE chat ---------------- */
export function CorePanel({ initial, onConsumed, onOpenMemory }: { initial: string | null; onConsumed: () => void; onOpenMemory: (id: string) => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const convo = useRef<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setMsgs((m) => [...m, { role: "user", content: message }]);
    setInput("");
    setBusy(true);
    try {
      const r = await api<{ conversationId: string; answer: string; citations: Cite[]; trace: Step[] }>("/api/core", {
        method: "POST", body: JSON.stringify({ message, conversationId: convo.current }),
      });
      convo.current = r.conversationId;
      setMsgs((m) => [...m, { role: "assistant", content: r.answer, citations: r.citations, trace: r.trace }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: e instanceof Error ? e.message : "CORE failed", error: true }]);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // React dev mode runs effects twice; remember what we already sent so the command bar message goes out once.
  const sentInitial = useRef<string | null>(null);
  useEffect(() => {
    if (!initial) { sentInitial.current = null; return; }
    if (sentInitial.current === initial) return;
    sentInitial.current = initial;
    onConsumed();
    void send(initial);
  }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, busy]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto pr-1" aria-live="polite">
        {!msgs.length && <p className="muted">Ask CORE anything. It answers from your memories, reads links you paste, checks the latest news, and hands bigger jobs to your agents. Sources are cited.</p>}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "bubble user" : `bubble core${m.error ? " err" : ""}`}>
            {m.role === "assistant" && !m.error
              ? <Markdown text={numberCitations(m.content, (m.citations ?? []).map((c) => c.id))} openMemory={onOpenMemory} />
              : <div className="whitespace-pre-wrap">{m.content}</div>}
            {!!m.citations?.length && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.citations.map((c, n) => <button key={c.id} className="chip" onClick={() => onOpenMemory(c.id)}>[{n + 1}] {c.title}</button>)}
              </div>
            )}
            {!!m.trace?.length && (
              <details className="mt-2 text-xs muted">
                <summary className="cursor-pointer">Execution trace</summary>
                <ul className="mt-1 space-y-0.5">{m.trace.map((s, n) => <li key={n}>{s.ok ? "✓" : "✗"} <b>{s.step}</b> · {s.ms}ms · {s.detail}</li>)}</ul>
              </details>
            )}
          </div>
        ))}
        {busy && <div className="bubble core muted">CORE is working… (reading pages or asking an agent can take a minute)</div>}
        <div ref={end} />
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <input className="field flex-1" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Message CORE" maxLength={8000} aria-label="Message CORE" />
        <button className="btn" disabled={busy || !input.trim()}>Send</button>
      </form>
    </div>
  );
}

/* ---------------- MEMORY ---------------- */
type LinkRow = { id: string; status: string; score: number | null; from: { id: string; title: string } | null; to: { id: string; title: string } | null };

export function MemoryPanel({ focusId, onChanged }: { focusId: string | null; onChanged: () => void }) {
  const [items, setItems] = useState<Memory[]>([]);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<Memory | null>(null);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [form, setForm] = useState({ kind: "note" as Kind, title: "", content: "", url: "", tags: "" });
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setSaving(true); setErr(""); setNote("");
    try {
      const fd = new FormData();
      fd.set("file", file);
      if (form.title.trim()) fd.set("title", form.title.trim());
      if (form.content.trim()) fd.set("note", form.content.trim());
      if (form.tags.trim()) fd.set("tags", form.tags);
      const res = await fetch("/api/memories/upload", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Upload failed (${res.status})`);
      setNote(`Saved ${file.name}${json.extractedChars ? ` (${json.extractedChars.toLocaleString()} characters of text read)` : ""}.`);
      setForm({ ...form, title: "", content: "", url: "", tags: "" });
      await Promise.all([load(q), loadLinks()]); onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
    finally { setSaving(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  const load = useCallback(async (query: string) => {
    try {
      const r = await api<{ results: Memory[]; mode: string }>(`/api/memories${query ? `?q=${encodeURIComponent(query)}` : ""}`);
      setItems(r.results); setMode(r.mode); setErr("");
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load"); }
  }, []);
  const loadLinks = useCallback(async () => {
    try { setLinks((await api<{ links: LinkRow[] }>("/api/links")).links); } catch { /* shown via main error on next load */ }
  }, []);

  useEffect(() => { void load(""); void loadLinks(); }, [load, loadLinks]);
  useEffect(() => {
    if (!focusId) return;
    api<{ memory: Memory }>(`/api/memories/${focusId}`).then((r) => setOpen(r.memory)).catch((e) => setErr(e.message));
  }, [focusId]);

  async function capture(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(""); setNote("");
    try {
      const r = await api<{ embedded: boolean; suggested: number }>("/api/memories", { method: "POST", body: JSON.stringify(form) });
      setNote(`Saved.${r.suggested ? ` ${r.suggested} related memories suggested below.` : ""}${r.embedded ? "" : " (keyword search only; no embeddings configured)"}`);
      setForm({ ...form, title: "", content: "", url: "", tags: "" });
      await Promise.all([load(q), loadLinks()]); onChanged();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not save"); }
    finally { setSaving(false); }
  }

  async function saveEdit() {
    if (!open) return;
    try {
      await api(`/api/memories/${open.id}`, { method: "PATCH", body: JSON.stringify({ title: open.title, content: open.content, tags: open.tags }) });
      setOpen(null); await load(q); onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not update"); }
  }
  async function remove() {
    if (!open || !confirm(`Delete "${open.title}"? This can't be undone.`)) return;
    try { await api(`/api/memories/${open.id}`, { method: "DELETE" }); setOpen(null); await Promise.all([load(q), loadLinks()]); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not delete"); }
  }
  async function decide(id: string, status: "confirmed" | "rejected") {
    try { await api("/api/links", { method: "PATCH", body: JSON.stringify({ id, status }) }); await loadLinks(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not update link"); }
  }

  const suggested = links.filter((l) => l.status === "suggested");

  if (open) {
    return (
      <div className="space-y-3">
        <button className="link" onClick={() => setOpen(null)}>← Back</button>
        <input className="field w-full" value={open.title} onChange={(e) => setOpen({ ...open, title: e.target.value })} aria-label="Title" />
        <textarea className="field h-56 w-full" value={open.content} onChange={(e) => setOpen({ ...open, content: e.target.value })} aria-label="Content" />
        <input className="field w-full" value={open.tags.join(", ")} onChange={(e) => setOpen({ ...open, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} placeholder="tags, comma separated" aria-label="Tags" />
        <p className="muted text-xs">{open.kind} · source: {open.source}{open.url && <> · <a className="link" href={open.url} target="_blank" rel="noreferrer noopener">open link</a></>}{open.storage_path && <> · <a className="link" href={`/api/memories/${open.id}/file`} target="_blank" rel="noreferrer">open file</a></>} · created {when(open.created_at)} · updated {when(open.updated_at)}</p>
        {err && <p className="error">{err}</p>}
        <div className="flex gap-2"><button className="btn" onClick={saveEdit}>Save</button><button className="btn danger" onClick={remove}>Delete</button></div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <form onSubmit={capture} className="space-y-2">
        <h3 className="h3">Capture</h3>
        <textarea className="field h-24 w-full" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Anything worth remembering…" aria-label="Content" maxLength={200000} />
        <div className="flex gap-2">
          <input className="field flex-1" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title (optional)" aria-label="Title" maxLength={300} />
          <select className="field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })} aria-label="Kind">{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
        </div>
        <div className="flex gap-2">
          <input className="field flex-1" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="Link to save (https://…)" aria-label="URL" />
          <input className="field flex-1" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="tags" aria-label="Tags" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" disabled={saving || (!form.content.trim() && !form.url.trim() && !form.title.trim())}>{saving ? "Saving…" : "Save to memory"}</button>
          <label className={`chip cursor-pointer${saving ? " opacity-50" : ""}`}>
            Upload file
            <input ref={fileRef} type="file" className="sr-only" disabled={saving}
              accept=".pdf,.docx,.txt,.md,.csv,image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          </label>
          <span className="muted text-xs">PDF, Word, text, images · max 4 MB</span>
        </div>
        {note && <p className="ok">{note}</p>}
        {err && <p className="error">{err}</p>}
      </form>

      {!!suggested.length && (
        <div>
          <h3 className="h3">Suggested connections</h3>
          <p className="muted text-xs">Found by similarity. Nothing is linked until you confirm.</p>
          <ul className="mt-2 space-y-2">
            {suggested.map((l) => (
              <li key={l.id} className="card text-sm">
                <button className="link text-left" onClick={() => l.from && setFocus(l.from.id)}>{l.from?.title}</button> ↔ <button className="link text-left" onClick={() => l.to && setFocus(l.to.id)}>{l.to?.title}</button>
                <span className="muted"> · {Math.round((l.score ?? 0) * 100)}%</span>
                <div className="mt-1 flex gap-2"><button className="chip" onClick={() => decide(l.id, "confirmed")}>Confirm</button><button className="chip" onClick={() => decide(l.id, "rejected")}>Dismiss</button></div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between"><h3 className="h3">Memories</h3><a className="link text-xs" href="/api/export">Export JSON</a></div>
        <form className="my-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void load(q.trim()); }}>
          <input className="field flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your memory" aria-label="Search memories" />
          <button className="btn">Search</button>
        </form>
        {q.trim() && mode && <p className="muted text-xs">{mode === "hybrid" ? "Keyword + semantic search" : "Keyword search"}</p>}
        <ul className="space-y-2">
          {items.map((m) => (
            <li key={m.id}>
              <button className="card w-full text-left" onClick={() => setOpen(m)}>
                <div className="font-medium">{m.title}</div>
                <div className="muted line-clamp-2 text-xs">{m.content.slice(0, 200)}</div>
                <div className="muted mt-1 text-[11px]">{m.kind} · {when(m.created_at)}{m.tags.length ? ` · ${m.tags.map((t) => `#${t}`).join(" ")}` : ""}</div>
              </button>
            </li>
          ))}
          {!items.length && !err && <li className="muted">{q.trim() ? "Nothing matched." : "No memories yet. Capture your first one above."}</li>}
        </ul>
      </div>
    </div>
  );

  function setFocus(id: string) {
    api<{ memory: Memory }>(`/api/memories/${id}`).then((r) => setOpen(r.memory)).catch((e) => setErr(e.message));
  }
}

/* ---------------- PROFILE ---------------- */
const LIST_FIELDS = [["interests", "Interests"], ["projects", "Current projects"], ["goals", "Goals"], ["news_topics", "Preferred news topics"], ["research_priorities", "Research priorities"]] as const;

export function ProfilePanel() {
  const [p, setP] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  useEffect(() => {
    api<{ profile: Record<string, unknown> | null }>("/api/profile").then(({ profile }) => {
      const o: Record<string, string> = { display_name: String(profile?.display_name ?? ""), communication: String(profile?.communication ?? "") };
      for (const [k] of LIST_FIELDS) o[k] = ((profile?.[k] as string[] | undefined) ?? []).join(", ");
      setP(o);
    }).catch((e) => setMsg(e.message));
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try { await api("/api/profile", { method: "PUT", body: JSON.stringify(p) }); setMsg("Saved."); } catch (e2) { setMsg(e2 instanceof Error ? e2.message : "Could not save"); }
  }
  return (
    <form onSubmit={save} className="space-y-3">
      <p className="muted text-sm">CORE reads this. Only what you write here is used; ORBIT never turns guesses into profile facts.</p>
      <label className="block text-sm">Name<input className="field mt-1 w-full" value={p.display_name ?? ""} onChange={(e) => setP({ ...p, display_name: e.target.value })} /></label>
      {LIST_FIELDS.map(([k, label]) => (
        <label key={k} className="block text-sm">{label} <span className="muted">(comma separated)</span>
          <input className="field mt-1 w-full" value={p[k] ?? ""} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></label>
      ))}
      <label className="block text-sm">How CORE should talk to you<textarea className="field mt-1 h-20 w-full" value={p.communication ?? ""} onChange={(e) => setP({ ...p, communication: e.target.value })} maxLength={1000} /></label>
      <button className="btn">Save profile</button> {msg && <span className="muted text-sm">{msg}</span>}
    </form>
  );
}

/* ---------------- ANALYTICS (real counts) ---------------- */
export function AnalyticsPanel() {
  const sb = useMemo(() => createClient(), []);
  const [s, setS] = useState<{ memories: number; messages: number; calls: number; tokens: number; events: { type: string; created_at: string }[] } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    (async () => {
      const count = (t: string) => sb.from(t).select("id", { count: "exact", head: true });
      const [m, msg, usage, ev] = await Promise.all([
        count("memories"), count("messages"),
        sb.from("usage").select("input_tokens, output_tokens"),
        sb.from("events").select("type, created_at").order("created_at", { ascending: false }).limit(8),
      ]);
      const bad = m.error || msg.error || usage.error || ev.error;
      if (bad) throw bad;
      const rows = usage.data ?? [];
      setS({ memories: m.count ?? 0, messages: msg.count ?? 0, calls: rows.length, tokens: rows.reduce((a, r) => a + r.input_tokens + r.output_tokens, 0), events: ev.data ?? [] });
    })().catch((e) => setErr(e.message ?? "Could not load analytics"));
  }, [sb]);
  if (err) return <p className="error">{err}</p>;
  if (!s) return <p className="muted">Loading…</p>;
  const stat = (n: number | string, l: string) => <div className="card"><div className="text-2xl">{n}</div><div className="muted text-xs">{l}</div></div>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">{stat(s.memories, "memories")}{stat(s.messages, "chat messages")}{stat(s.calls, "CORE calls")}{stat(s.tokens.toLocaleString(), "tokens used")}</div>
      <p className="muted text-xs">CORE runs on your Claude subscription, so there is no per-token cost to track.</p>
      <h3 className="h3">Recent activity</h3>
      <ul className="space-y-1 text-sm">{s.events.map((e, i) => <li key={i}><b>{e.type}</b> <span className="muted">{when(e.created_at)}</span></li>)}{!s.events.length && <li className="muted">Nothing yet.</li>}</ul>
    </div>
  );
}

/* ---------------- planets that arrive in later phases ---------------- */
export function LaterPanel({ id }: { id: PlanetId }) {
  const p = planetById(id)!;
  return (
    <div className="space-y-3">
      <p>{p.blurb}</p>
      <p className="card text-sm">Not built yet. This workspace arrives in <b>Phase {p.phase}</b>. ORBIT shows only features that work, so nothing here is simulated.</p>
    </div>
  );
}
