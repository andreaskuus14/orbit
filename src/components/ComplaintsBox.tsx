"use client";
import { useEffect, useState } from "react";
import type { ChatItem, Theme } from "@/lib/complaints-pure";

// BUSINESS → Niches: the "What users hate" tab of a kept niche. Public reviews only, read-only; every theme links to its sources.
type Report = { at: string; themes: Theme[]; notes: string[]; sample: number; angle?: string };

async function call(id: string, action?: string) {
  const res = await fetch(action ? "/api/business/complaints" : `/api/business/complaints?id=${id}`, { cache: "no-store", ...(action && { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id }) }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json.report as Report | null;
}

export default function ComplaintsBox({ id }: { id: string }) {
  const [r, setR] = useState<Report | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => { call(id).then(setR, (e: Error) => setErr(e.message)); }, [id]);
  const act = async (a: string) => { setBusy(a); setErr(""); try { setR(await call(id, a)); } catch (e) { setErr((e as Error).message); } setBusy(""); };
  return (
    <details className="text-xs">
      <summary className="cursor-pointer"><b>What users hate</b>{r ? ` (${r.themes.length} themes from ${r.sample} reviews)` : ""}</summary>
      <div className="space-y-1.5 pt-1">
        {r?.themes.map((t) => (
          <div key={t.name}>
            <b>{t.name}</b> <span className="muted">· {t.count} complaint{t.count === 1 ? "" : "s"}</span>
            <ul className="list-disc pl-5">{t.quotes.map((q) => <li key={q.text}>“{q.text}” <a className="underline" href={q.url} target="_blank" rel="noreferrer noopener">source</a></li>)}</ul>
          </div>
        ))}
        {r && !r.themes.length && <p className="muted">No complaints found in the public sources.</p>}
        {r?.notes.map((n) => <p key={n} className="muted">{n}</p>)}
        {r?.angle && <p className="whitespace-pre-line rounded border border-white/10 p-1.5 select-all">{r.angle}</p>}
        {err && <p className="error" role="alert">{err}</p>}
        <div className="flex flex-wrap gap-1.5">
          <button className="chip" disabled={!!busy} onClick={() => void act("mine")}>{busy === "mine" ? "Reading public reviews…" : r ? "Read again" : "Read public reviews"}</button>
          {!!r?.themes.length && <button className="chip" disabled={!!busy} onClick={() => void act("angle")}>{busy === "angle" ? "CORE is writing…" : "Fixes and selling angle"}</button>}
        </div>
        <p className="muted">Reads App Store reviews (from your rival links) and Reddit search. No logins, nothing posted.</p>
      </div>
    </details>
  );
}

// BUSINESS → Niches: customer chats from client sites (self-hosted Chatwoot). CORE drafts; nothing goes out until the owner clicks Send.
export function ChatsBox() {
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const load = () => fetch("/api/business/complaints?chats=1", { cache: "no-store" }).then((r) => r.json()).then((j) => setChats(j.chats ?? []), () => setErr("Could not load chats"));
  useEffect(() => { void load(); }, []);
  const send = async (c: ChatItem) => {
    setBusy(c.id); setErr("");
    const res = await fetch("/api/business/complaints", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send", chat: c.id, text: edit[c.id] ?? c.draft ?? "" }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) setErr(j.error || `Send failed (${res.status})`); else await load();
    setBusy("");
  };
  if (!chats.length) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer"><b>Customer chats</b> ({chats.filter((c) => !c.sentAt).length} waiting)</summary>
      <div className="space-y-2 pt-1">
        {chats.map((c) => (
          <div key={c.id} className="rounded border border-white/10 p-1.5 space-y-1">
            <p><b>{c.sender || "Customer"}</b> <span className="muted">· {c.at.slice(0, 16).replace("T", " ")}</span></p>
            <p className="whitespace-pre-line">{c.text}</p>
            {c.sentAt ? <p className="muted">Sent: {c.draft}</p> : <>
              <label className="block"><span className="muted">Reply (edit before sending)</span>
                <textarea className="w-full" rows={3} value={edit[c.id] ?? c.draft ?? ""} placeholder={c.draft === undefined ? "CORE is drafting…" : ""} onChange={(e) => setEdit({ ...edit, [c.id]: e.target.value })} /></label>
              <button className="chip" disabled={!!busy || !(edit[c.id] ?? c.draft ?? "").trim()} onClick={() => void send(c)}>{busy === c.id ? "Sending…" : "Send to customer"}</button>
            </>}
          </div>
        ))}
        {err && <p className="error" role="alert">{err}</p>}
      </div>
    </details>
  );
}
