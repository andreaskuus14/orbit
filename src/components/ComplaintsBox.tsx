"use client";
import { useEffect, useState } from "react";
import type { ChatItem, Theme } from "@/lib/complaints-pure";
import { useT } from "./i18n";

// BUSINESS → Niches: the "What users hate" tab of a kept niche. Public reviews only, read-only; every theme links to its sources.
type Report = { at: string; themes: Theme[]; notes: string[]; sample: number; angle?: string };

async function call(id: string, action?: string) {
  const res = await fetch(action ? "/api/business/complaints" : `/api/business/complaints?id=${id}`, { cache: "no-store", ...(action && { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id }) }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json.report as Report | null;
}

export default function ComplaintsBox({ id }: { id: string }) {
  const { t } = useT();
  const [r, setR] = useState<Report | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => { call(id).then(setR, (e: Error) => setErr(e.message)); }, [id]);
  const act = async (a: string) => { setBusy(a); setErr(""); try { setR(await call(id, a)); } catch (e) { setErr((e as Error).message); } setBusy(""); };
  return (
    <details className="text-xs">
      <summary className="cursor-pointer"><b>{t("cmpl.title")}</b>{r ? ` (${t("cmpl.themes", { n: r.themes.length, s: r.sample })})` : ""}</summary>
      <div className="space-y-1.5 pt-1">
        {r?.themes.map((th) => (
          <div key={th.name}>
            <b>{th.name}</b> <span className="muted">· {th.count === 1 ? t("cmpl.one") : t("cmpl.many", { n: th.count })}</span>
            <ul className="list-disc pl-5">{th.quotes.map((q) => <li key={q.text}>“{q.text}” <a className="underline" href={q.url} target="_blank" rel="noreferrer noopener">{t("cmpl.source")}</a></li>)}</ul>
          </div>
        ))}
        {r && !r.themes.length && <p className="muted">{t("cmpl.none")}</p>}
        {r?.notes.map((n) => <p key={n} className="muted">{n}</p>)}
        {r?.angle && <p className="whitespace-pre-line rounded border border-white/10 p-1.5 select-all">{r.angle}</p>}
        {err && <p className="error" role="alert">{err}</p>}
        <div className="flex flex-wrap gap-1.5">
          <button className="chip" disabled={!!busy} onClick={() => void act("mine")}>{busy === "mine" ? t("cmpl.reading") : r ? t("cmpl.again") : t("cmpl.read")}</button>
          {!!r?.themes.length && <button className="chip" disabled={!!busy} onClick={() => void act("angle")}>{busy === "angle" ? t("cmpl.writing") : t("cmpl.angle")}</button>}
        </div>
        <p className="muted">{t("cmpl.help")}</p>
      </div>
    </details>
  );
}

// BUSINESS → Niches: customer chats from client sites (self-hosted Chatwoot). CORE drafts; nothing goes out until the owner clicks Send.
export function ChatsBox() {
  const { t } = useT();
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const load = () => fetch("/api/business/complaints?chats=1", { cache: "no-store" }).then((r) => r.json()).then((j) => setChats(j.chats ?? []), () => setErr(t("cmpl.chatsFail")));
  useEffect(() => { void load(); }, []);
  const send = async (c: ChatItem) => {
    setBusy(c.id); setErr("");
    const res = await fetch("/api/business/complaints", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send", chat: c.id, text: edit[c.id] ?? c.draft ?? "" }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) setErr(j.error || t("cmpl.sendFail", { s: res.status })); else await load();
    setBusy("");
  };
  if (!chats.length) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer"><b>{t("cmpl.chats")}</b> ({t("cmpl.waiting", { n: chats.filter((c) => !c.sentAt).length })})</summary>
      <div className="space-y-2 pt-1">
        {chats.map((c) => (
          <div key={c.id} className="rounded border border-white/10 p-1.5 space-y-1">
            <p><b>{c.sender || t("cmpl.customer")}</b> <span className="muted">· {new Date(c.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Tallinn" })}</span></p>
            <p className="whitespace-pre-line">{c.text}</p>
            {c.sentAt ? <p className="muted">{t("cmpl.sent")} {c.draft}</p> : <>
              <label className="block"><span className="muted">{t("cmpl.reply")}</span>
                <textarea className="w-full" rows={3} value={edit[c.id] ?? c.draft ?? ""} placeholder={c.draft !== undefined ? "" : c.draftFailed ? t("cmpl.noDraft", { why: c.draftFailed }) : t("cmpl.drafting")} onChange={(e) => setEdit({ ...edit, [c.id]: e.target.value })} /></label>
              <button className="chip" disabled={!!busy || !(edit[c.id] ?? c.draft ?? "").trim()} onClick={() => void send(c)}>{busy === c.id ? t("cmpl.sending") : t("cmpl.send")}</button>
            </>}
          </div>
        ))}
        {err && <p className="error" role="alert">{err}</p>}
      </div>
    </details>
  );
}
