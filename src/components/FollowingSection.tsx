"use client";
import { useCallback, useEffect, useState } from "react";
import { age, REFRESH_MS, type Headline } from "@/lib/follows-pure";
import { FOLLOWS_EVENT } from "./follow-command";
import { useT } from "./i18n";

type Topic = { name: string; at: number | null; items: (Headline & { new: boolean })[] };
const safeHref = (u: string) => (/^https?:\/\//i.test(u) ? u : "#");

/** INTELLIGENCE → Following: the latest 3 headlines per followed topic, "new" since the last visit. */
export function FollowingSection() {
  const { t: tr } = useT();
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [add, setAdd] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async (visit = false) => {
    try {
      const res = await fetch(`/api/news/follows${visit ? "?visit=1" : ""}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load followed topics");
      setTopics(json.topics); setErr("");
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load followed topics"); }
  }, []);
  useEffect(() => {
    void load(true); // opening the panel is a visit; later reloads keep this visit's "new" badges
    const t = setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS);
    const on = () => void load();
    addEventListener(FOLLOWS_EVENT, on);
    return () => { clearInterval(t); removeEventListener(FOLLOWS_EVENT, on); };
  }, [load]);

  async function change(method: "POST" | "DELETE", topic: string) {
    try {
      const res = await fetch(method === "POST" ? "/api/news/follows" : `/api/news/follows?topic=${encodeURIComponent(topic)}`,
        { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify({ topic }) : undefined });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not update");
      if (method === "POST") setAdd("");
      dispatchEvent(new Event(FOLLOWS_EVENT)); // reloads this list and the globe's pulse
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not update"); }
  }

  return (
    <div className="card space-y-2 text-sm">
      <div><b>{tr("fol.title")}</b> <span className="muted">· {tr("fol.note")}</span></div>
      <form onSubmit={(e) => { e.preventDefault(); if (add.trim()) void change("POST", add.trim()); }} className="flex gap-2">
        <input className="field min-w-0 flex-1" value={add} onChange={(e) => setAdd(e.target.value)} placeholder={tr("fol.ph")} aria-label={tr("fol.aria")} maxLength={60} />
        <button className="btn">{tr("fol.btn")}</button>
      </form>
      {err && <p className="error">{err}</p>}
      {topics?.length === 0 && <p className="muted text-xs">{tr("fol.none")}</p>}
      <ul className="space-y-3">
        {topics?.map((t) => {
          const fresh = t.items.filter((h) => h.new).length;
          return (
            <li key={t.name}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{t.name}{fresh > 0 && <span className="chip ml-2 text-xs" style={{ borderColor: "var(--cyan)" }}>{tr("fol.new", { n: fresh })}</span>}</span>
                <button className="chip" onClick={() => change("DELETE", t.name)} aria-label={tr("fol.unfollowAria", { name: t.name })}>{tr("fol.unfollow")}</button>
              </div>
              <ul className="mt-1 space-y-1">
                {t.items.map((h) => (
                  <li key={h.url}>
                    {h.new && <span className="text-xs" style={{ color: "var(--cyan)" }}>● </span>}
                    <a className="link" href={safeHref(h.url)} target="_blank" rel="noreferrer noopener">{h.title}</a>
                    <span className="muted text-xs"> — {h.source ?? tr("intel.unknownSrc")}{h.published_at ? ` · ${tr("fol.ago", { t: age(h.published_at) })}` : ""}</span>
                  </li>
                ))}
                {!t.items.length && <li className="muted text-xs">{t.at ? tr("fol.noHeadlines") : tr("fol.fetching")}</li>}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
