"use client";
import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { highlight } from "./Highlight";
import { FollowingSection } from "./FollowingSection";
import WorkspaceFrame, { useWorkspaceView } from "./WorkspaceFrame";
import { useT } from "./i18n";
import { checkClaims, type FeedHealth, type Prefs, type rankingGate, type Vote } from "@/lib/news-intel-pure";
import { schedState } from "@/lib/panel-states-pure";

type Cite = { id: string; title: string; url: string; source: string | null; published_at: string | null; evidence?: "fetched" | "snippet"; passage?: string; fetched_url?: string };
type Dev = { key: string; rev: string; status: "new" | "corrected" | "resolved"; title: string; why: string; independent: number; articles: Article[] };
type Intel = { prefs: Prefs; topics: { topic: string; items: Dev[]; known: number }[]; health: Record<string, Partial<FeedHealth> & { disabled?: boolean }>; done: string[];
  votes?: Record<string, Vote>; gate?: ReturnType<typeof rankingGate> };
const VIEWS = [{ id: "today", label: "Today" }, { id: "following", label: "Following" }, { id: "research", label: "Research" }, { id: "sources", label: "Sources" }] as const;
type ViewId = (typeof VIEWS)[number]["id"];
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
  const { t } = useT();
  const lines = b.content.split("\n");
  const checks = b.citations.some((c) => c.evidence) ? checkClaims(b.content, b.citations) : []; // INT03; older briefings have no evidence
  const failed = checks.filter((c) => !c.ok);
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {checks.length > 0 && <p className={`text-xs ${failed.length ? "error" : "muted"}`}>{t("intel.claimsOk", { ok: checks.length - failed.length, n: checks.length })}</p>}
      {failed.slice(0, 5).map((c, i) => <p key={i} className="error text-xs">“{c.sentence}” — {t("intel.claimFail", { what: c.what })}</p>)}
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
            {c.evidence && (
              <details className="ml-4"><summary className="muted cursor-pointer">{c.evidence === "fetched" ? t("intel.fetched") : t("intel.snippet")}</summary>
                <p className="muted whitespace-pre-wrap">{c.passage}</p>{c.fetched_url && <p className="muted">{c.fetched_url}</p>}</details>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function SchedNote({ s, retry }: { s: ReturnType<typeof schedState>; retry: () => void }) {
  const { t } = useT();
  if (s === "configured") return <p className="muted text-xs">{t("intel.sched.on")}</p>;
  if (s === "checking") return <p className="muted text-xs" role="status">{t("intel.sched.checking")}</p>;
  if (s === "unconfigured") return (
    <div className="text-xs" role="status">
      <p>{t("intel.sched.off")}</p>
      <ol className="muted list-decimal pl-5"><li>{t("intel.sched.step1")}</li><li>{t("intel.sched.step2")}</li><li>{t("intel.sched.step3")}</li></ol>
      <button className="chip mt-1" onClick={retry}>{t("state.retry")}</button>
    </div>
  );
  return <p className="error text-xs" role="alert">{t(s === "unavailable" ? "intel.sched.unavailable" : "intel.sched.error")} <button className="chip" onClick={retry}>{t("state.retry")}</button></p>;
}

export function IntelligencePanel() {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sched, setSched] = useState<{ scheduled?: boolean; failed?: "network" | "server" }>({}); // undefined = still checking: no setup notice yet
  const [open, setOpen] = useState<string | null>(null);
  const { t } = useT();
  const [view, setView] = useWorkspaceView<ViewId>("intelligence", VIEWS);
  const [intel, setIntel] = useState<Intel | null>(null);
  const [running, setRunning] = useState(false);
  const [add, setAdd] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setSched((s) => (s.failed ? {} : s)); // a retry goes back to "checking"
    try {
      const [b, f] = await Promise.all([
        api<{ briefings: Briefing[]; articles: Article[]; jobs: Job[]; scheduled: boolean }>("/api/briefings"),
        api<{ feeds: Feed[] }>("/api/feeds"),
      ]);
      setBriefings(b.briefings); setArticles(b.articles); setJobs(b.jobs); setSched({ scheduled: b.scheduled }); setFeeds(f.feeds);
      setOpen((o) => o ?? b.briefings[0]?.id ?? null);
      setIntel(await api<Intel>("/api/news/intel"));
    } catch (e) {
      setSched((s) => (s.scheduled === undefined ? { failed: e instanceof TypeError ? "network" : "server" } : s)); // fetch throws TypeError when offline
      setErr(e instanceof Error ? e.message : "Could not load");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function generate(focus: "world" | "mine" | "all") {
    setRunning(true); setErr("");
    try {
      const r = await api<{ briefing: Briefing }>("/api/pulse", { method: "POST", body: JSON.stringify({ focus }) });
      setOpen(r.briefing.id); setView("research");
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

  const post = async (body: object) => {
    try { const r = await api<{ existing?: boolean }>("/api/news/intel", { method: "POST", body: JSON.stringify(body) }); setErr(r.existing ? t("intel.already") : ""); void load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not save"); }
  };
  const lastJob = jobs[0];
  return (
    <WorkspaceFrame planet="intelligence" title={t("intel.title")} context={t("intel.context")} view={view} onView={setView}
      views={VIEWS.map((v) => ({ ...v, label: t(`intel.v.${v.id}` as const) }))}>
      {err && view !== "today" && <p className="error">{err}</p>}
      {view === "today" && (<>
      <div className="card space-y-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span><b>Pulse</b> <span className="muted">· news intelligence agent</span></span>
            <span className="flex flex-wrap justify-end gap-1.5">
              <button className="btn" onClick={() => generate("world")} disabled={running}>{running ? t("intel.working") : t("intel.world")}</button>
              <button className="chip" onClick={() => generate("mine")} disabled={running}>{t("intel.mine")}</button>
              <button className="chip" onClick={() => generate("all")} disabled={running}>{t("intel.all")}</button>
            </span>
          </div>
          <SchedNote s={schedState(sched)} retry={() => void load()} />
          {lastJob && (
            <p className={`text-xs ${lastJob.status === "failed" ? "error" : "muted"}`}>
              Last run: {lastJob.status} · {when(lastJob.started_at)}{lastJob.detail ? ` · ${lastJob.detail}` : ""}
            </p>
          )}
          {running && <p className="muted text-xs">Fetching feeds, grouping stories and writing the briefing. This usually takes under a minute.</p>}
          {err && <p className="error">{err}</p>}
        </div>
  
          {intel && <Developments intel={intel} post={post} />}
      </>)}

      {view === "following" && (<>
        <FollowingSection />
        {intel && <PrefsForm prefs={intel.prefs} save={(p) => post({ action: "prefs", prefs: p })} />}
        {intel?.gate && <RankingGate g={intel.gate} />}
      </>)}

      {view === "research" && (<>
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
        <h3 className="h3">Latest articles</h3>
        <ul className="space-y-2 text-sm">
          {articles.map((a) => (
            <li key={a.id}>
              <a className="link" href={safeHref(a.url)} target="_blank" rel="noreferrer noopener">{a.title}</a>
              <div className="muted text-xs">{a.source ?? "unknown"} · {when(a.published_at)}{a.topic ? ` · ${a.topic}` : ""}</div>
            </li>
          ))}
          {!articles.length && <li className="muted">No articles yet. They arrive with the first briefing.</li>}
        </ul>
      </>)}

      {view === "sources" && (
        <div className="space-y-3">
          <form onSubmit={follow} className="flex gap-2">
            <input className="field flex-1" value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Topic (e.g. Roblox) or RSS feed URL" aria-label="Topic or feed URL" maxLength={2000} />
            <button className="btn">Follow</button>
          </form>
          <button className="chip" onClick={addWorldPack}>+ Add World news pack (BBC, Guardian, Al Jazeera, NPR, DW + war, economy, politics)</button>
          <p className="muted text-xs">Topics use Google News search feeds. Any RSS/Atom URL works too. Your first briefing starts with your profile’s news topics.</p>
          <a className="chip inline-block" href="/api/feeds?format=opml" download="orbit-subscriptions.opml">{t("intel.exportFeeds")}</a>
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
                <FeedStatus f={f} h={intel?.health[f.id]} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </WorkspaceFrame>
  );
}

/** INT07: per-feed health (last success, error kind, empty, paused, next retry). */
function FeedStatus({ f, h }: { f: Feed; h?: Intel["health"][string] }) {
  const { t } = useT();
  const kind = !f.enabled ? "disabled" : h?.kind ?? (f.last_error ? "fetch" : f.last_fetched_at ? "ok" : "never");
  const bad = kind === "parse" || kind === "fetch";
  return (
    <div className={`text-xs ${bad ? "error" : "muted"}`}>
      {t(`intel.h.${kind}` as "intel.h.ok")}{bad && (h?.lastError ?? f.last_error) ? `: ${h?.lastError ?? f.last_error}` : ""}
      {h?.lastSuccess && ` · ${t("intel.lastOk", { at: when(h.lastSuccess) })}`}
      {bad && h?.nextRetry && f.enabled && ` · ${t("intel.retry", { at: when(h.nextRetry) })}`}
      {bad && h?.lastSuccess && ` · ${t("intel.keepGood")}`}
    </div>
  );
}

/** INT02/04/06: developments since the last "Mark seen", with why-this, all reports, less-like-this and story actions. */
function Developments({ intel, post }: { intel: Intel; post: (b: object) => Promise<void> }) {
  const { t } = useT();
  const [task, setTask] = useState<string | null>(null);
  const [obj, setObj] = useState(""); const [acc, setAcc] = useState("");
  const done = new Set(intel.done);
  return (
    <div className="space-y-3">
      <p className="muted text-xs">{t("intel.sinceSeen")}</p>
      {intel.topics.map((tp) => (
        <div key={tp.topic} className="card space-y-2">
          <div className="flex items-center justify-between gap-2">
            <b>{tp.topic}</b>
            {tp.items.length > 0 && <button className="chip" onClick={() => post({ action: "ack", topic: tp.topic, events: tp.items.map(({ key, rev }) => ({ key, rev })) })}>{t("intel.markSeen")}</button>}
          </div>
          {!tp.items.length && <p className="muted text-xs">{t("intel.nothingNew", { n: tp.known })}</p>}
          <ul className="space-y-3">
            {tp.items.map((d) => {
              const a = d.articles[0], url = a.url;
              return (
                <li key={d.key} className="space-y-1">
                  <div><span className="chip mr-2 text-xs" style={d.status === "new" ? { borderColor: "var(--cyan)" } : undefined}>{t(`intel.st.${d.status}` as const)}</span>
                    <a className="link" href={safeHref(url)} target="_blank" rel="noreferrer noopener">{d.title}</a></div>
                  <div className="muted text-xs">{d.why} · {a.source ?? "unknown"} · {when(a.published_at)}</div>
                  {d.articles.length > 1 && (
                    <details className="text-xs"><summary className="muted cursor-pointer">{t("intel.copies", { n: d.articles.length })} · {t("intel.sources", { n: d.independent })}</summary>
                      <ul className="ml-4">{d.articles.map((x) => <li key={x.id}><a className="link" href={safeHref(x.url)} target="_blank" rel="noreferrer noopener">{x.title}</a> <span className="muted">— {x.source ?? "?"}, {when(x.published_at)}</span></li>)}</ul>
                    </details>
                  )}
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {(["useful", "not_useful", "wrong"] as const).map((v) => (
                      <button key={v} className="chip" aria-pressed={intel.votes?.[d.key] === v} onClick={() => post({ action: "feedback", key: d.key, title: d.title, vote: v, sources: d.independent })}>{t(`intel.fb.${v}` as const)}</button>
                    ))}
                    <button className="chip" onClick={() => post({ action: "less", title: d.title })}>{t("intel.less")}</button>
                    {(["note", "watch"] as const).map((k) => (
                      <button key={k} className="chip" disabled={done.has(`${k}:${url}`)} onClick={() => post({ action: "story", kind: k, title: d.title, url, published_at: a.published_at })}>{t(`intel.${k}` as const)}</button>
                    ))}
                    <button className="chip" onClick={() => setTask(task === d.key ? null : d.key)}>{t("intel.task")}</button>
                  </div>
                  {task === d.key && (
                    <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); void post({ action: "story", kind: "task", title: d.title, url, published_at: a.published_at, objective: obj, acceptance: acc }).then(() => { setTask(null); setObj(""); setAcc(""); }); }}>
                      <input className="field w-full" required maxLength={300} value={obj} onChange={(e) => setObj(e.target.value)} placeholder={t("intel.objective")} aria-label={t("intel.objective")} />
                      <input className="field w-full" required maxLength={300} value={acc} onChange={(e) => setAcc(e.target.value)} placeholder={t("intel.acceptance")} aria-label={t("intel.acceptance")} />
                      <button className="btn">{t("intel.propose")}</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** INT08: votes so far and whether a ranking change would pass the held-out check. Nothing re-ranks on its own. */
function RankingGate({ g }: { g: NonNullable<Intel["gate"]> }) {
  const { t } = useT();
  const acc = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
  return (
    <div className="card space-y-1 text-xs">
      <b className="text-sm">{t("intel.fb.title")}</b>
      <p>{t("intel.fb.counts", { n: g.votes, h: g.held, u: g.useful, b: g.notUseful })}</p>
      <p>{t("intel.fb.compare", { a: acc(g.current), b: acc(g.candidate) })}</p>
      <p className={g.adopt ? "" : "muted"}>{t(g.why as "intel.fb.whyFew", { need: g.need })}</p>
      <p className="muted">{t("intel.fb.how")}</p>
    </div>
  );
}

/** INT04: topics, regions, projects, exclusions and length. */
function PrefsForm({ prefs, save }: { prefs: Prefs; save: (p: Partial<Prefs>) => Promise<void> }) {
  const { t } = useT();
  const [f, setF] = useState({ topics: prefs.topics.join(", "), regions: prefs.regions.join(", "), projects: prefs.projects.join(", "), exclusions: prefs.exclusions.join(", "), length: prefs.length });
  return (
    <form className="card space-y-2" onSubmit={(e) => { e.preventDefault(); void save(f as unknown as Partial<Prefs>); }}>
      <b>{t("intel.prefs")}</b>
      {(["topics", "regions", "projects", "exclusions"] as const).map((k) => (
        <label key={k} className="block text-xs">{t(`intel.${k}` as const)}
          <input className="field w-full" maxLength={600} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
      ))}
      <label className="block text-xs">{t("intel.length")}{" "}
        <select className="field" value={f.length} onChange={(e) => setF({ ...f, length: e.target.value as Prefs["length"] })}>
          {(["short", "normal", "long"] as const).map((l) => <option key={l} value={l}>{t(`intel.len.${l}` as const)}</option>)}
        </select></label>
      {prefs.less.length > 0 && <p className="muted text-xs">{t("intel.lessCount", { n: prefs.less.length })}</p>}
      <button className="btn">{t("intel.savePrefs")}</button>
    </form>
  );
}
