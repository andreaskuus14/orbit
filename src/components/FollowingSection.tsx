"use client";
import { useCallback, useEffect, useState } from "react";
import { age, REFRESH_MS, type Headline } from "@/lib/follows-pure";
import { FOLLOWS_EVENT } from "./follow-command";

type Topic = { name: string; at: number | null; items: (Headline & { new: boolean })[] };
const safeHref = (u: string) => (/^https?:\/\//i.test(u) ? u : "#");

/** INTELLIGENCE → Following: the latest 3 headlines per followed topic, "new" since the last visit. */
export function FollowingSection() {
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
    const t = setInterval(() => load(), REFRESH_MS);
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
      <div><b>Following</b> <span className="muted">· topics, people and countries you watch (refreshed every 30 min)</span></div>
      <form onSubmit={(e) => { e.preventDefault(); if (add.trim()) void change("POST", add.trim()); }} className="flex gap-2">
        <input className="field flex-1" value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Follow a topic (e.g. Estonia, AI, Jynxzi)" aria-label="Topic to follow" maxLength={60} />
        <button className="btn">Follow</button>
      </form>
      {err && <p className="error">{err}</p>}
      {topics?.length === 0 && <p className="muted text-xs">Nothing followed yet. Type a topic above or say “follow YouTube”.</p>}
      <ul className="space-y-3">
        {topics?.map((t) => {
          const fresh = t.items.filter((h) => h.new).length;
          return (
            <li key={t.name}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{t.name}{fresh > 0 && <span className="chip ml-2 text-xs" style={{ borderColor: "var(--cyan)" }}>{fresh} new</span>}</span>
                <button className="chip" onClick={() => change("DELETE", t.name)} aria-label={`Unfollow ${t.name}`}>Unfollow</button>
              </div>
              <ul className="mt-1 space-y-1">
                {t.items.map((h) => (
                  <li key={h.url}>
                    {h.new && <span className="text-xs" style={{ color: "var(--cyan)" }}>● </span>}
                    <a className="link" href={safeHref(h.url)} target="_blank" rel="noreferrer noopener">{h.title}</a>
                    <span className="muted text-xs"> — {h.source ?? "unknown source"}{h.published_at ? ` · ${age(h.published_at)} ago` : ""}</span>
                  </li>
                ))}
                {!t.items.length && <li className="muted text-xs">{t.at ? "No headlines in the last 2 days." : "Fetching…"}</li>}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
