"use client";
import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { highlight } from "./Highlight";

type Cite = { id: string; title: string; url: string; source: string | null; published_at: string | null };
type Briefing = { id: string; kind: string; title: string; content: string; citations: Cite[]; article_count: number; created_at: string };
type Article = { id: string; title: string; url: string; source: string | null; topic: string | null; published_at: string | null };
type Feed = { id: string; url: string; title: string | null; topic: string | null; enabled: boolean; last_fetched_at: string | null; last_error: string | null };
type Job = { status: string; detail: string | null; started_at: string; finished_at: string | null };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "date unknown");
const safeHref = (u: string) => (/^https?:\/\//i.test(u) ? u : "#");

/** Inline markdown: **bold** and [a:<id>] citations rendered as numbered links to the real article. */
function inline(text: string, cites: Cite[]): ReactNode[] {
  return text.split(/(\[a:[0-9a-f-]{36}\]|\*\*[^*]+\*\*)/gi).map((part, i) => {
    const c = part.match(/^\[a:([0-9a-f-]{36})\]$/i);
    if (c) {
      const n = cites.findIndex((x) => x.id === c[1].toLowerCase());
      return n === -1 ? null : (
        <a key={i} href={safeHref(cites[n].url)} target="_blank" rel="noreferrer noopener" className="link" title={`${cites[n].title} — ${cites[n].source ?? ""}`}>[{n + 1}]</a>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i} className="hl-strong">{highlight(part.slice(2, -2), i)}</strong>;
    return <Fragment key={i}>{highlight(part, i)}</Fragment>;
  });
}

function BriefingBody({ b }: { b: Briefing }) {
  const lines = b.content.split("\n");
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {lines.map((l, i) => {
        const t = l.trim();
        if (!t) return null;
        if (t.startsWith("### ")) return <h4 key={i} className="mt-3 font-semibold">{inline(t.slice(4), b.citations)}</h4>;
        if (t.startsWith("## ")) return <h3 key={i} className="h3 mt-4">{t.slice(3)}</h3>;
        if (/^([-*]|\d+\.)\s/.test(t)) return <p key={i} className="pl-4">• {inline(t.replace(/^([-*]|\d+\.)\s/, ""), b.citations)}</p>;
        return <p key={i}>{inline(t, b.citations)}</p>;
      })}
      <h3 className="h3 mt-4">Sources</h3>
      <ol className="space-y-1 text-xs">
        {b.citations.map((c, i) => (
          <li key={c.id}>
            [{i + 1}] <a className="link" href={safeHref(c.url)} target="_blank" rel="noreferrer noopener">{c.title}</a>
            <span className="muted"> — {c.source ?? "unknown source"}, {when(c.published_at)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function IntelligencePanel() {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [scheduled, setScheduled] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<"briefings" | "sources" | "articles">("briefings");
  const [running, setRunning] = useState(false);
  const [add, setAdd] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const [b, f] = await Promise.all([
        api<{ briefings: Briefing[]; articles: Article[]; jobs: Job[]; scheduled: boolean }>("/api/briefings"),
        api<{ feeds: Feed[] }>("/api/feeds"),
      ]);
      setBriefings(b.briefings); setArticles(b.articles); setJobs(b.jobs); setScheduled(b.scheduled); setFeeds(f.feeds);
      setOpen((o) => o ?? b.briefings[0]?.id ?? null);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not load"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function generate(focus: "world" | "mine" | "all") {
    setRunning(true); setErr("");
    try {
      const r = await api<{ briefing: Briefing }>("/api/pulse", { method: "POST", body: JSON.stringify({ focus }) });
      setOpen(r.briefing.id); setTab("briefings");
    } catch (e) { setErr(e instanceof Error ? e.message : "Pulse failed"); }
    finally { setRunning(false); void load(); }
  }

  async function follow(e: React.FormEvent) {
    e.preventDefault();
    const v = add.trim();
    if (!v) return;
    try {
      await api("/api/feeds", { method: "POST", body: JSON.stringify(/^https?:\/\//i.test(v) ? { url: v } : { topic: v }) });
      setAdd(""); void load();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not add"); }
  }
  async function addWorldPack() {
    try { const r = await api<{ added: number }>("/api/feeds", { method: "POST", body: JSON.stringify({ pack: "world" }) }); setErr(r.added ? "" : "World news pack is already added."); void load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not add"); }
  }
  async function toggle(f: Feed) {
    try { await api("/api/feeds", { method: "PATCH", body: JSON.stringify({ id: f.id, enabled: !f.enabled }) }); void load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not update"); }
  }
  async function remove(f: Feed) {
    try { await api(`/api/feeds?id=${f.id}`, { method: "DELETE" }); void load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not remove"); }
  }

  const lastJob = jobs[0];
  return (
    <div className="space-y-4">
      <div className="card space-y-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span><b>Pulse</b> <span className="muted">· news intelligence agent</span></span>
          <span className="flex flex-wrap justify-end gap-1.5">
            <button className="btn" onClick={() => generate("world")} disabled={running}>{running ? "Pulse is working…" : "World brief"}</button>
            <button className="chip" onClick={() => generate("mine")} disabled={running}>My topics</button>
            <button className="chip" onClick={() => generate("all")} disabled={running}>Everything</button>
          </span>
        </div>
        <p className="muted text-xs">
          {scheduled ? "Scheduled briefings on: Morning 07:30 · Midday 12:30 · Evening 19:00 · Weekly Sun 18:30 (while this PC runs ORBIT)."
            : "Scheduled briefings are off until SUPABASE_SECRET_KEY is set (see README). On-demand briefings work now."}
        </p>
        {lastJob && (
          <p className={`text-xs ${lastJob.status === "failed" ? "error" : "muted"}`}>
            Last run: {lastJob.status} · {when(lastJob.started_at)}{lastJob.detail ? ` · ${lastJob.detail}` : ""}
          </p>
        )}
        {running && <p className="muted text-xs">Fetching feeds, grouping stories and writing the briefing. This usually takes under a minute.</p>}
        {err && <p className="error">{err}</p>}
      </div>

      <div className="flex gap-1.5" role="tablist">
        {(["briefings", "sources", "articles"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className="chip" style={tab === t ? { borderColor: "var(--cyan)" } : undefined} onClick={() => setTab(t)}>
            {t === "briefings" ? `Briefings (${briefings.length})` : t === "sources" ? `Sources (${feeds.length})` : "Latest articles"}
          </button>
        ))}
      </div>

      {tab === "briefings" && (
        <ul className="space-y-2">
          {briefings.map((b) => (
            <li key={b.id} className="card">
              <button className="w-full text-left" onClick={() => setOpen(open === b.id ? null : b.id)} aria-expanded={open === b.id}>
                <div className="font-medium">{b.title}</div>
                <div className="muted text-xs">{when(b.created_at)} · {b.article_count} articles · {b.citations.length} cited</div>
              </button>
              {open === b.id && <div className="mt-3"><BriefingBody b={b} /></div>}
            </li>
          ))}
          {!briefings.length && <li className="muted text-sm">No briefings yet. Press “World brief” or “My topics”.</li>}
        </ul>
      )}

      {tab === "sources" && (
        <div className="space-y-3">
          <form onSubmit={follow} className="flex gap-2">
            <input className="field flex-1" value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Topic (e.g. Roblox) or RSS feed URL" aria-label="Topic or feed URL" maxLength={2000} />
            <button className="btn">Follow</button>
          </form>
          <button className="chip" onClick={addWorldPack}>+ Add World news pack (BBC, Guardian, Al Jazeera, NPR, DW + war, economy, politics)</button>
          <p className="muted text-xs">Topics use Google News search feeds. Any RSS/Atom URL works too. Your first briefing starts with your profile’s news topics.</p>
          <ul className="space-y-2">
            {feeds.map((f) => (
              <li key={f.id} className="card text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className={f.enabled ? "" : "muted"}>{f.title ?? (f.topic ? `Topic: ${f.topic}` : f.url)}</span>
                  <span className="flex gap-1.5">
                    <button className="chip" onClick={() => toggle(f)}>{f.enabled ? "Pause" : "Resume"}</button>
                    <button className="chip" onClick={() => remove(f)} aria-label={`Remove ${f.title ?? f.url}`}>Remove</button>
                  </span>
                </div>
                <div className={`text-xs ${f.last_error ? "error" : "muted"}`}>
                  {f.last_error ? `Failed: ${f.last_error}` : f.last_fetched_at ? `Fetched ${when(f.last_fetched_at)}` : "Not fetched yet"}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "articles" && (
        <ul className="space-y-2 text-sm">
          {articles.map((a) => (
            <li key={a.id}>
              <a className="link" href={safeHref(a.url)} target="_blank" rel="noreferrer noopener">{a.title}</a>
              <div className="muted text-xs">{a.source ?? "unknown"} · {when(a.published_at)}{a.topic ? ` · ${a.topic}` : ""}</div>
            </li>
          ))}
          {!articles.length && <li className="muted">No articles yet. They arrive with the first briefing.</li>}
        </ul>
      )}
    </div>
  );
}
