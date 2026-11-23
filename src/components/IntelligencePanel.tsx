"use client";
// INTELLIGENCE, one surface (owner 22 Nov): the briefing first ("For you", then the world), each story with a quiet trust mark
// whose evidence opens on hover, focus or click, and its actions behind one "…" menu. Following, Watches, past briefings
// (Research) and Sources live in a secondary sheet ("Sources & more"); deep links to those views open the sheet. No run counters
// in the UI (the job log keeps them). The globe's search and region chips stay on: this panel switches the globe tools on.
// Pure parts: lib/briefing-view-pure.ts.
import { Fragment, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as RKey, type ReactNode } from "react";
import { highlight } from "./Highlight";
import { dedupe } from "@/lib/dashboard";
import { packOrder } from "@/lib/source-packs-pure";
import { FollowingSection } from "./FollowingSection";
import { WatchesSection } from "./WatchesSection";
import WorkspaceFrame, { useWorkspaceView } from "./WorkspaceFrame";
import { useT } from "./i18n";
import { useManual } from "./planet-manual";
import { useUiMotion } from "./motion/motion";
import type { FeedHealth, Prefs, rankingGate, Vote } from "@/lib/news-intel-pure";
import { schedState } from "@/lib/panel-states-pure";
import { parseBriefing, runLine, storyKey, storyTrust, type Cite, type Story, type Trust } from "@/lib/briefing-view-pure";
import css from "./IntelligencePanel.module.css";

type Dev = { key: string; rev: string; status: "new" | "corrected" | "resolved"; title: string; why: string; independent: number; articles: Article[] };
type Intel = { prefs: Prefs; topics: { topic: string; items: Dev[]; known: number }[]; health: Record<string, Partial<FeedHealth> & { disabled?: boolean }>; done: string[];
  votes?: Record<string, Vote>; gate?: ReturnType<typeof rankingGate> };
const VIEWS = [{ id: "today", label: "Today" }, { id: "following", label: "Following" }, { id: "watches", label: "Watches" }, { id: "research", label: "Research" }, { id: "sources", label: "Sources" }] as const;
type ViewId = (typeof VIEWS)[number]["id"];
type SheetView = Exclude<ViewId, "today">;
type Briefing = { id: string; kind: string; title: string; content: string; citations: Cite[]; article_count: number; created_at: string };
type Article = { id: string; title: string; url: string; source: string | null; topic: string | null; published_at: string | null };
type Feed = { id: string; url: string; title: string | null; topic: string | null; enabled: boolean; last_fetched_at: string | null; last_error: string | null };
type Job = { status: string; detail: string | null; started_at: string; finished_at: string | null };
type Post = (b: object) => Promise<void>;
type Focus = "world" | "mine" | "all";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");
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

/** One "…" menu: arrow keys move, Esc closes and returns focus, a click outside closes. */
type Item = { label: string; run: () => void; checked?: boolean; disabled?: boolean } | "sep";
function DotsMenu({ label, items }: { label: string; items: Item[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null), btn = useRef<HTMLButtonElement>(null), id = useId();
  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>("[role^=menuitem]:not(:disabled)")?.focus();
    const off = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener("pointerdown", off);
    return () => removeEventListener("pointerdown", off);
  }, [open]);
  const key = (e: RKey) => {
    if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btn.current?.focus(); return; }
    if (e.key === "Tab") { setOpen(false); return; }
    const all = [...(wrap.current?.querySelectorAll<HTMLElement>("[role^=menuitem]:not(:disabled)") ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    const j = e.key === "ArrowDown" ? (i + 1) % all.length : e.key === "ArrowUp" ? (i - 1 + all.length) % all.length : e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : -1;
    if (j >= 0) { e.preventDefault(); all[j]?.focus(); }
  };
  return (
    <div ref={wrap} className={css.menuWrap} onKeyDown={open ? key : undefined}>
      <button ref={btn} type="button" className={css.dots} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)} onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}>…</button>
      {open && (
        <div id={id} role="menu" aria-label={label} className={css.menu}>
          {items.map((it, i) => it === "sep" ? <hr key={i} /> : (
            <button key={i} type="button" role={it.checked === undefined ? "menuitem" : "menuitemcheckbox"} aria-checked={it.checked} disabled={it.disabled} tabIndex={-1}
              onClick={() => { setOpen(false); btn.current?.focus(); it.run(); }}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The quiet trust mark: a dot and one word; hover, focus or click shows the evidence (outlets, read in full, what didn't check out). */
function TrustMark({ trust, cites, all }: { trust: Trust; cites: Cite[]; all: Cite[] }) {
  const { t } = useT();
  const [hover, setHover] = useState(false), [pinned, setPinned] = useState(false);
  const wrap = useRef<HTMLDivElement>(null), id = useId();
  const open = hover || pinned;
  const word = trust.level === "confirmed" ? t("intel.tr.confirmed", { n: trust.outlets }) : trust.level === "single" ? t("intel.tr.single") : t("intel.tr.check");
  const flagged = trust.flags.filter((f) => f.kind !== "one_source"), notes = trust.flags.filter((f) => f.kind === "one_source");
  return (
    <div ref={wrap} className={css.trust} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)} onBlur={(e) => { if (!wrap.current?.contains(e.relatedTarget as Node)) { setHover(false); setPinned(false); } }}
      onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setHover(false); setPinned(false); } }}>
      <button type="button" className={`${css.trustBtn} ${css[trust.level]}`} aria-expanded={open} aria-controls={id} aria-label={t("intel.tr.aria", { level: word })}
        onClick={() => setPinned((p) => !p)}>
        <span className={css.dot} aria-hidden="true" /><span aria-hidden="true">{t(`intel.tr.short.${trust.level}`)}</span>
      </button>
      <div id={id} className={css.pop} role="group" aria-label={word} hidden={!open}>
        <b>{word}</b>
        {trust.cited > 0 && <span>{t("intel.tr.read", { r: trust.read, n: trust.cited })}</span>}
        {flagged.length > 0 && <div><span className={css.flag}>{t("intel.tr.flagged")}</span>
          <ul>{flagged.map((f, i) => <li key={i}><q>{f.sentence}</q> <span className={css.flag}>— {t(`intel.fl.${f.kind}`, { d: f.detail ?? "" })}</span></li>)}</ul></div>}
        {notes.map((f, i) => <span key={i} className={css.src}><q>{f.sentence}</q> — {t("intel.fl.one_source")}</span>)}
        {cites.length > 0 && <ul>{cites.map((c) => (
          <li key={c.id}>[{all.findIndex((x) => x.id === c.id) + 1}] <a className="link" href={safeHref(c.url)} target="_blank" rel="noreferrer noopener">{c.source ?? t("intel.unknownSrc")}</a>
            <span className={css.src}> · {c.evidence === "fetched" ? t("intel.tr.full") : t("intel.tr.part")}</span></li>))}</ul>}
      </div>
    </div>
  );
}

/** The story actions shared by briefing stories and "new since" rows: votes, less like this, save note, watch, propose task. */
function useStoryActions(post: Post, intel: Intel | null) {
  const { t } = useT();
  const done = new Set(intel?.done ?? []);
  return (s: { key: string; title: string; url?: string; published_at: string | null; sources: number }, onTask: () => void): Item[] => [
    ...(["useful", "not_useful", "wrong"] as const).map((v) => ({ label: t(`intel.fb.${v}`), checked: intel?.votes?.[s.key] === v,
      run: () => void post({ action: "feedback", key: s.key, title: s.title, vote: v, sources: s.sources }) })),
    "sep" as const,
    { label: t("intel.less"), run: () => void post({ action: "less", title: s.title }) },
    ...(s.url ? (["note", "watch"] as const).map((k) => ({ label: t(`intel.${k}`), disabled: done.has(`${k}:${s.url}`),
      run: () => void post({ action: "story", kind: k, title: s.title, url: s.url, published_at: s.published_at }) })) : []),
    ...(s.url ? [{ label: t("intel.task"), run: onTask }] : []),
  ];
}

function TaskForm({ title, url, published_at, post, done }: { title: string; url: string; published_at: string | null; post: Post; done: () => void }) {
  const { t } = useT();
  const [obj, setObj] = useState(""), [acc, setAcc] = useState("");
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  return (
    <form className={css.task} onSubmit={(e) => { e.preventDefault(); void post({ action: "story", kind: "task", title, url, published_at, objective: obj, acceptance: acc }).then(done); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); done(); } }}>
      <input ref={first} className="field w-full" required maxLength={300} value={obj} onChange={(e) => setObj(e.target.value)} placeholder={t("intel.objective")} aria-label={t("intel.objective")} />
      <input className="field w-full" required maxLength={300} value={acc} onChange={(e) => setAcc(e.target.value)} placeholder={t("intel.acceptance")} aria-label={t("intel.acceptance")} />
      <span className="flex gap-1.5"><button className="btn">{t("intel.propose")}</button><button type="button" className="chip" onClick={done}>{t("common.close")}</button></span>
    </form>
  );
}

function StoryCard({ b, story, post, actions }: { b: Briefing; story: Story; post: Post; actions: ReturnType<typeof useStoryActions> }) {
  const { t } = useT();
  const [task, setTask] = useState(false);
  const trust = storyTrust(story, b.citations);
  const mine = story.cites.map((id) => b.citations.find((c) => c.id === id)).filter((c): c is Cite => !!c);
  const title = story.title ?? story.lines[0]?.replace(/\[a:[^\]]+\]/g, "").slice(0, 80) ?? "";
  const first = mine[0];
  return (
    <article className={`card ${css.story}`} aria-label={story.title ?? undefined}>
      <div className={css.head}>
        {story.title ? <h4 className={css.title}>{story.title}</h4> : <span className="flex-1" />}
        {mine.length > 0 && <TrustMark trust={trust} cites={mine} all={b.citations} />}
        <DotsMenu label={t("intel.storyMenu", { title })} items={actions({ key: storyKey(b.id, title), title, url: first?.url, published_at: first?.published_at ?? null, sources: trust.outlets }, () => setTask(true))} />
      </div>
      <div className={css.body}>{story.lines.map((l, i) => <p key={i}>{inline(l.replace(/^([-*]|\d+\.)\s+/, ""), b.citations)}</p>)}</div>
      {task && first && <TaskForm title={title} url={first.url} published_at={first.published_at} post={post} done={() => setTask(false)} />}
    </article>
  );
}

function BriefingView({ b, post, intel }: { b: Briefing; post: Post; intel: Intel | null }) {
  const { t } = useT();
  const actions = useStoryActions(post, intel);
  const p = parseBriefing(b.content);
  return (
    <>
      {p.sections.map((s, i) => (
        <section key={i} className={css.section} aria-label={s.heading || b.title}>
          {s.heading && <h3 className={css.sh}>{s.heading}</h3>}
          {s.kind === "next"
            ? <ul className={css.next}>{s.stories.flatMap((st) => st.lines).map((l, j) => <li key={j}>{inline(l.replace(/^([-*]|\d+\.)\s+/, ""), b.citations)}</li>)}</ul>
            : s.stories.map((st, j) => <StoryCard key={`${b.id}-${i}-${j}`} b={b} story={st} post={post} actions={actions} />)}
        </section>
      ))}
      <details className={css.foot}>
        <summary>{t("intel.sourcesN", { n: b.citations.length })}</summary>
        {p.removed > 0 && <p className="mt-1">{t("intel.removed", { n: p.removed })}</p>}
        <ol>{b.citations.map((c, i) => (
          <li key={c.id}>[{i + 1}] <a className="link" href={safeHref(c.url)} target="_blank" rel="noreferrer noopener">{c.title}</a>
            <span> — {c.source ?? t("intel.unknownSrc")}, {when(c.published_at)}{c.evidence ? ` · ${c.evidence === "fetched" ? t("intel.tr.full") : t("intel.tr.part")}` : ""}</span>
            {c.passage && <details className="ml-4"><summary className="cursor-pointer">{c.evidence === "fetched" ? t("intel.fetched") : t("intel.snippet")}</summary>
              <p className="whitespace-pre-wrap">{c.passage}</p>{c.fetched_url && <p>{c.fetched_url}</p>}</details>}
          </li>))}</ol>
      </details>
    </>
  );
}

function SchedNote({ s, retry, quiet }: { s: ReturnType<typeof schedState>; retry: () => void; quiet?: boolean }) {
  const { t } = useT();
  if (s === "configured") return quiet ? null : <p className="muted text-xs">{t("intel.sched.on")}</p>;
  if (s === "checking") return quiet ? null : <p className="muted text-xs" role="status">{t("intel.sched.checking")}</p>;
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
  const [briefings, setBriefings] = useState<Briefing[] | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sched, setSched] = useState<{ scheduled?: boolean; failed?: "network" | "server" }>({}); // undefined = still checking: no setup notice yet
  const [open, setOpen] = useState<string | null>(null);
  const { t } = useT();
  const motion = useUiMotion();
  const [view, setView] = useWorkspaceView<ViewId>("intelligence", VIEWS);
  const [tools, setTools] = useManual("intelligence");
  const [intel, setIntel] = useState<Intel | null>(null);
  const [running, setRunning] = useState(false);
  const [focus, setFocus] = useState<Focus>("world");
  const [listen, setListen] = useState(false);
  const [add, setAdd] = useState("");
  const [err, setErr] = useState("");
  const moreRef = useRef<HTMLButtonElement>(null), sheetRef = useRef<HTMLDivElement>(null), wasSheet = useRef(false);
  useEffect(() => { if (!tools) setTools(true); }, [tools]); // eslint-disable-line react-hooks/exhaustive-deps -- one surface: the globe's search and regions are always on

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
      setBriefings((b) => b ?? []);
      setErr(e instanceof Error ? e.message : "Could not load");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const sheet = view !== "today";
  useEffect(() => { // focus follows the sheet: into it on open, back to "Sources & more" on close
    if (sheet) sheetRef.current?.querySelector<HTMLElement>("[data-sheet-back]")?.focus();
    else if (wasSheet.current) moreRef.current?.focus();
    wasSheet.current = sheet;
  }, [sheet]);

  async function generate(f: Focus) {
    setRunning(true); setErr("");
    try {
      const r = await api<{ briefing: Briefing }>("/api/pulse", { method: "POST", body: JSON.stringify({ focus: f }) });
      setOpen(r.briefing.id); setView("today");
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
  async function addPack(pack: string, label: string) {
    try { const r = await api<{ added: number }>("/api/feeds", { method: "POST", body: JSON.stringify({ pack }) }); setErr(r.added ? "" : t("intel.src.has", { label })); void load(); }
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
  const post: Post = async (body) => {
    try { const r = await api<{ existing?: boolean }>("/api/news/intel", { method: "POST", body: JSON.stringify(body) }); setErr(r.existing ? t("intel.already") : ""); void load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not save"); }
  };

  const b = briefings?.find((x) => x.id === open) ?? briefings?.[0] ?? null;
  const run = runLine(running ? { status: "running", detail: null, started_at: new Date().toISOString() } : jobs[0]);
  const s = schedState(sched);
  const sheetViews = VIEWS.filter((v): v is (typeof VIEWS)[number] & { id: SheetView } => v.id !== "today").map((v) => ({ ...v, label: t(`intel.v.${v.id}` as const) }));

  return (
    <div className={css.page} data-ws="intelligence" data-intel-surface="">
      {/* The briefing surface stays mounted under the sheet, so its scroll and open menus survive a visit to Sources. */}
      <div hidden={sheet} className="flex flex-col gap-[0.9rem]">
        <div className={css.bar}>
          <div className={css.statusRow}>
          <p className={css.status} role="status" aria-live="polite">
            {run?.state === "running" ? <>{t("intel.working")} {t("intel.runningNote")}</>
              : run?.state === "failed" ? <span className="error">{t("intel.failed", { e: run.error ?? "" })}</span>
              : b ? t("intel.made", { at: when(b.created_at), n: b.citations.length }) : null}
          </p>
          {b && <button type="button" className="chip shrink-0" aria-pressed={listen} aria-label={t("intel.listenAria")} onClick={() => setListen((l) => !l)}>{t("intel.listen")}</button>}
          </div>
          <div className={css.actions}>
            <button type="button" className="btn" onClick={() => void generate(focus)} disabled={running}>{running ? t("intel.working") : t("intel.new")}</button>
            <select className="chip" aria-label={t("intel.focus")} value={focus} onChange={(e) => setFocus(e.target.value as Focus)} disabled={running}>
              <option value="world">{t("intel.world")}</option><option value="mine">{t("intel.mine")}</option><option value="all">{t("intel.all")}</option>
            </select>
            <span className={css.grow} />
            <button ref={moreRef} type="button" className="chip" aria-expanded={sheet} aria-controls="intel-sheet" title={t("intel.moreAria")} onClick={() => setView("following")}>{t("intel.more")}</button>
          </div>
          {/* two-voice audio of this briefing (local Kokoro voices; the first play takes a minute to make it) */}
          {listen && b && <audio key={b.id} className={css.audio} controls autoPlay preload="none" src={`/api/briefings/${b.id}/audio`} aria-label={`${t("intel.listen")}: ${b.title}`} />}
          {s !== "configured" && s !== "checking" && <SchedNote s={s} retry={() => void load()} quiet />}
          {err && <p className="error text-sm" role="alert">{err}</p>}
        </div>

        {briefings === null ? <div className={css.skeleton} role="status" aria-label={t("intel.loading")}><span /><span /><span /></div>
          : b ? <BriefingView key={b.id} b={b} post={post} intel={intel} />
          : <p className="muted">{t("intel.empty")}</p>}

        {intel && <Developments intel={intel} post={post} />}
      </div>

      {sheet && (
        <div id="intel-sheet" ref={sheetRef} className={motion ? css.sheetIn : undefined}
          onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.stopPropagation(); setView("today"); } }}>
          <WorkspaceFrame planet="intelligence" title={t("intel.title")} view={view as SheetView} onView={setView} views={sheetViews}
            action={<button type="button" data-sheet-back className="link text-xs" onClick={() => setView("today")}>← {t("intel.back")}</button>}>
            {err && <p className="error" role="alert">{err}</p>}
            {view === "following" && (<>
              <FollowingSection />
              {intel && <PrefsForm prefs={intel.prefs} save={(p) => post({ action: "prefs", prefs: p })} />}
              {intel?.gate && <RankingGate g={intel.gate} />}
            </>)}
            {view === "watches" && <WatchesSection />}
            {view === "research" && (<>
              <ul className="space-y-2">
                {(briefings ?? []).map((x) => (
                  <li key={x.id} className="card flex items-center gap-2">
                    <span className="min-w-0 flex-1"><b className="block truncate">{x.title}</b>
                      <span className="muted text-xs">{when(x.created_at)} · {t("intel.articlesN", { a: x.article_count, c: x.citations.length })}</span></span>
                    {x.id === b?.id ? <span className="muted text-xs">{t("intel.showing")}</span>
                      : <button type="button" className="chip shrink-0" onClick={() => { setOpen(x.id); setListen(false); setView("today"); }}>{t("intel.read")}</button>}
                  </li>
                ))}
                {!briefings?.length && <li className="muted text-sm">{t("intel.noBriefings")}</li>}
              </ul>
              <h3 className={css.sh}>{t("intel.articles")}</h3>
              <ul className="space-y-2 text-sm">
                {dedupe(articles).map((a) => ( // the same story via two feeds (22 Nov: four titles listed twice)
                  <li key={a.id}>
                    <a className="link" href={safeHref(a.url)} target="_blank" rel="noreferrer noopener">{a.title}</a>
                    <div className="muted text-xs">{a.source ?? t("intel.unknownSrc")} · {when(a.published_at)}{a.topic ? ` · ${a.topic}` : ""}</div>
                  </li>
                ))}
                {!articles.length && <li className="muted">{t("intel.noArticles")}</li>}
              </ul>
            </>)}
            {view === "sources" && (
              <div className="space-y-3">
                <SchedNote s={s} retry={() => void load()} />
                <form onSubmit={follow} className="flex gap-2">
                  <input className="field min-w-0 flex-1" value={add} onChange={(e) => setAdd(e.target.value)} placeholder={t("intel.src.ph")} aria-label={t("intel.src.ph")} maxLength={2000} />
                  <button className="btn">{t("intel.src.follow")}</button>
                </form>
                <button className="chip text-left" onClick={() => addPack("world", "World news pack")}>{t("intel.src.pack")}</button>
                <div className="flex flex-wrap gap-2" role="group" aria-label={t("intel.src.packs")}>
                  {packOrder(feeds.map((f) => f.topic ?? "").filter(Boolean)).map((p) => {
                    const has = p.feeds.every((x) => feeds.some((f) => f.url === x.url));
                    return <button key={p.id} className="chip" disabled={has} aria-pressed={has} onClick={() => addPack(p.id, p.label)}>{has ? "✓" : "+"} {p.label}</button>;
                  })}
                </div>
                <p className="muted text-xs">{t("intel.src.note")}</p>
                <a className="chip inline-block" href="/api/feeds?format=opml" download="orbit-subscriptions.opml">{t("intel.exportFeeds")}</a>
                <ul className="space-y-2">
                  {feeds.map((f) => (
                    <li key={f.id} className="card text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`min-w-0 break-words ${f.enabled ? "" : "muted"}`}>{f.title ?? (f.topic ? t("intel.src.topic", { t: f.topic }) : f.url)}</span>
                        <span className="flex shrink-0 gap-1.5">
                          <button className="chip" onClick={() => toggle(f)}>{f.enabled ? t("intel.src.pause") : t("intel.src.resume")}</button>
                          <button className="chip" onClick={() => remove(f)} aria-label={t("intel.src.removeAria", { name: f.title ?? f.url })}>{t("intel.src.remove")}</button>
                        </span>
                      </div>
                      <FeedStatus f={f} h={intel?.health[f.id]} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </WorkspaceFrame>
        </div>
      )}
    </div>
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

/** INT02/04/06: what's new since the last "Mark seen", per topic; each row's actions sit behind its "…" menu. */
function Developments({ intel, post }: { intel: Intel; post: Post }) {
  const { t } = useT();
  const actions = useStoryActions(post, intel);
  const [task, setTask] = useState<string | null>(null);
  const topics = intel.topics.filter((tp) => tp.items.length);
  if (!topics.length) return null;
  return (
    <section className={css.section} aria-labelledby="intel-new-since">
      <h3 id="intel-new-since" className={css.sh}>{t("intel.newSince")}</h3>
      {topics.map((tp) => (
        <div key={tp.topic} className={`card ${css.story}`}>
          <div className={css.head}>
            <h4 className={css.title}>{tp.topic}</h4>
            <button className="chip" onClick={() => post({ action: "ack", topic: tp.topic, events: tp.items.map(({ key, rev }) => ({ key, rev })) })}>{t("intel.markSeen")}</button>
          </div>
          <ul className={css.dev}>
            {tp.items.map((d) => {
              const a = d.articles[0];
              return (
                <li key={d.key}>
                  <div className={css.devRow}>
                    <div className="min-w-0 flex-1">
                      <span className={`${css.pill} ${d.status === "new" ? css.new : ""}`}>{t(`intel.st.${d.status}` as const)}</span>
                      <a className="link" href={safeHref(a.url)} target="_blank" rel="noreferrer noopener">{d.title}</a>
                      <div className={css.meta}>{d.why} · {a.source ?? t("intel.unknownSrc")} · {when(a.published_at)}</div>
                      {d.articles.length > 1 && (
                        <details className={css.meta}><summary className="cursor-pointer">{t("intel.copies", { n: d.articles.length })} · {t("intel.sources", { n: d.independent })}</summary>
                          <ul className="ml-4">{d.articles.map((x) => <li key={x.id}><a className="link" href={safeHref(x.url)} target="_blank" rel="noreferrer noopener">{x.title}</a> — {x.source ?? "?"}, {when(x.published_at)}</li>)}</ul>
                        </details>
                      )}
                    </div>
                    <DotsMenu label={t("intel.storyMenu", { title: d.title })} items={actions({ key: d.key, title: d.title, url: a.url, published_at: a.published_at, sources: d.independent }, () => setTask(d.key))} />
                  </div>
                  {task === d.key && <TaskForm title={d.title} url={a.url} published_at={a.published_at} post={post} done={() => setTask(null)} />}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
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
