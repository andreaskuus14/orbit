"use client";
// MEMORY: a calm notes surface (reports/design-language.md + the owner's target look, reports/hf-refs/memory.png).
//   top: one search field ("find a memory, or type remember …"); left: Notes / Links / Learned / Journal / Tags with counts,
//   Needs you, People, Map; middle: the list grouped by day (title + small time, a thin violet marker on the open one);
//   right: the open memory: big title, "Today at 10:24 · Note · Project", tags, readable text, Related on hairlines.
// Secondary things (add with details, review, links to check, people, what ORBIT knows, all tools) open in the sheet.
// The star map is its own view (MemoryWorld). Journal rows only ever say "Journal entry": their text, title and tags never
// reach this UI (the API redacts them too).
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type SVGProps } from "react";
import { Button, Card, Empty, ErrorState, Loading, MoreMenu, Row, Sheet, toast, uiSound, IconClose, IconSend, IconPlus, IconBack, type MenuItem } from "./ui";
import { useT } from "./i18n";
import type { Key } from "@/lib/i18n-pure";
import { KINDS, type Kind } from "@/lib/kinds";
import { connections, isLearned, searchStars } from "@/lib/memory-world-pure";
import { whyMatched } from "@/lib/memory-workspace-pure";
import { counts, dayLabel, groupByDay, isJournal, kindColor, newestFirst, normMemories, normMemory, parseAsk, shownTags, tagCounts, tagsFromText, timeLabel, titleFrom, UNDO_MS, withoutPending, type Mem, type Star } from "@/lib/memory-planet-pure";
import type { RItem } from "@/lib/memory-review-pure";
import type { DupChoice } from "@/lib/memory-capture-pure";
import { applyReview, DupPreview, MemoryReview } from "./MemoryWorkspace";
import { KnowsPanel } from "./KnowsPanel";
import { BeliefsPanel } from "./BeliefsPanel";
import "@/app/memory-planet.css";
import { askConfirm } from "./ui/Dialog";

export type SheetKind = "add" | "review" | "links" | "all" | "knows" | "people";
export type Filter = { k: "all" } | { k: "links" } | { k: "learned" } | { k: "journal" } | { k: "tags" } | { k: "tag"; v: string };
type LinkRow = { id: string; status: string; score: number | null; from: { id: string; title: string } | null; to: { id: string; title: string } | null };
type Hit = Mem & { why?: string };
type ListRow = { id: string; title: string; kind: string; created_at: string | null; source?: string | null; why?: string };
const PAGE = 150;
/** MemoryWorld sends this when a nav event ("what do you know about me", "study") asks for a sheet. */
export const MEMORY_SHEET_EVENT = "orbit:memory-sheet";

async function call<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: T & { error?: string } }> {
  const r = await fetch(url, { ...init, headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers } });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
}

// 16 px stroke icons in the kit's style (1.5 px, currentColor, no emoji)
const I = ({ d, ...p }: { d: string } & SVGProps<SVGSVGElement>) => <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...p}><path d={d} /></svg>;
const IconNote = () => <I d="M4 1.75h5.5L12.5 4.75v9.5h-8.5zM9.25 1.75v3.25h3.25M6.5 8.5h3.5M6.5 11h3.5" />;
const IconBookmark = () => <I d="M4.25 1.75h7.5v12.5L8 11.25l-3.75 3z" />;
const IconSpark = () => <I d="M8 1.75l1.4 4.85L14.25 8 9.4 9.4 8 14.25 6.6 9.4 1.75 8 6.6 6.6z" />;
const IconLock = () => <I d="M3.75 7.25h8.5v7h-8.5zM5.5 7.25V5a2.5 2.5 0 015 0v2.25" />;
const IconTag = () => <I d="M1.75 8.4V1.75H8.4l5.85 5.85-6.65 6.65zM5 5h.01" />;
const IconPeople = () => <I d="M6 7.25a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5zM1.75 13.5c.4-2.4 2.1-3.75 4.25-3.75s3.85 1.35 4.25 3.75M10.75 3a2.25 2.25 0 010 4.25M12 9.9c1.2.45 2 1.6 2.25 3.6" />;
const IconMap = () => <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
  <path d="M4 11.5l3-6 3.5 3.5 2-4.5" strokeWidth="1" /><circle cx="4" cy="11.5" r="1.5" /><circle cx="7" cy="5.5" r="1.5" /><circle cx="10.5" cy="9" r="1.5" /><circle cx="12.5" cy="4.5" r="1.25" /></svg>;
const IconInbox = () => <I d="M1.75 9.25L3.5 3h9l1.75 6.25v4.5H1.75zM1.75 9.25h3.5l1 1.75h3.5l1-1.75h3.5" />;
const IconSearch = () => <I d="M7 12a5 5 0 100-10 5 5 0 000 10zM14 14l-3.5-3.5" />;
const kindIcon = (k: string) => (k === "link" ? <IconBookmark /> : k === "journal" ? <IconLock /> : <IconNote />);

export const MemoryShell = memo(function MemoryShell({ stars, links, edges, total, err, onRetry, onQuery, openId, onOpen, onFly, onChanged, onPatched, mode, onMode, onClose, List, people }: {
  stars: Star[] | null; links: { from: string; to: string }[]; edges: [number, number, number][]; total: number; err: boolean; onRetry: () => void;
  onQuery: (q: string) => void; openId: string | null; onOpen: (id: string | null) => void; onFly: (id: string) => void;
  onChanged: () => void; onPatched: (id: string, p: Partial<Star>) => void; mode: "notes" | "map"; onMode: (m: "notes" | "map") => void; onClose: () => void;
  List?: React.ComponentType<{ focusId: string | null; onChanged: () => void }>;
  people?: { node: ReactNode; count: number | null; onOpen: () => void };
}) {
  const { t, tn, lang } = useT();
  const readOnly = !List; // the public demo: the stars only, no requests beyond the map
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [filter, setFilter] = useState<Filter>({ k: "all" });
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => {
    const h = (e: Event) => { const k = (e as CustomEvent<SheetKind>).detail; if (k && (!readOnly || k === "knows")) setSheet(k); };
    addEventListener(MEMORY_SHEET_EVENT, h);
    return () => removeEventListener(MEMORY_SHEET_EVENT, h);
  }, [readOnly]);

  // ---- pending deletes (Undo window): hidden at once, sent after UNDO_MS, sent at once if the page goes away ----
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const sendDelete = useCallback(async (id: string, keepalive = false) => {
    timers.current.delete(id);
    const r = await fetch(`/api/memories/${id}`, { method: "DELETE", keepalive }).catch(() => null);
    setPending((s) => { const n = new Set(s); n.delete(id); return n; });
    if (!r || (!r.ok && r.status !== 404)) toast({ text: t("mp.deleteErr"), tone: "error" }); else onChanged();
  }, [onChanged, t]);
  useEffect(() => {
    const flush = () => { for (const [id, tm] of timers.current) { clearTimeout(tm); void sendDelete(id, true); } };
    addEventListener("pagehide", flush);
    return () => { removeEventListener("pagehide", flush); flush(); };
  }, [sendDelete]);

  // ---- Needs you: the review queue and suggested links ----
  const [queue, setQueue] = useState<RItem[] | null>(null), [linkRows, setLinkRows] = useState<LinkRow[]>([]), [busy, setBusy] = useState("");
  const loadNeeds = useCallback(async () => {
    const [q, l] = await Promise.all([call<{ queue?: RItem[] }>("/api/memories/hygiene").catch(() => null), call<{ links?: LinkRow[] }>("/api/links").catch(() => null)]);
    setQueue(q?.ok && Array.isArray(q.json.queue) ? q.json.queue : []);
    if (l?.ok && Array.isArray(l.json.links)) setLinkRows(l.json.links.filter((x) => x && x.from && x.to));
  }, []);
  useEffect(() => { if (!readOnly) void loadNeeds(); }, [loadNeeds, readOnly]);
  const suggested = linkRows.filter((l) => l.status === "suggested");
  const needN = (queue?.length ?? 0) + suggested.length;
  const seen = useRef<number | null>(null);
  useEffect(() => { if (queue === null) return; if (seen.current !== null && needN > seen.current) uiSound("needs"); seen.current = needN; }, [needN, queue]);
  const first = queue?.[0];
  const quick = first && (first.kind === "merge" || first.kind === "rerun" || first.kind === "version" || first.kind === "inferred" || first.kind === "stale-project");
  const act = async (it: RItem, d: "accepted" | "snoozed") => {
    setBusy(it.key);
    try { await applyReview(it, d, ""); if (d === "accepted") { toast({ text: t("mp.saved"), tone: "done" }); onChanged(); } await loadNeeds(); }
    catch { toast({ text: t("mp.saveErr"), tone: "error" }); }
    finally { setBusy(""); }
  };
  const decideLink = async (id: string, status: "confirmed" | "rejected") => {
    setLinkRows((xs) => xs.map((l) => (l.id === id ? { ...l, status } : l)));
    const r = await call("/api/links", { method: "PATCH", body: JSON.stringify({ id, status }) }).catch(() => null);
    if (!r?.ok) { toast({ text: t("mp.linkErr"), tone: "error" }); void loadNeeds(); } else if (status === "confirmed") onChanged();
  };

  // ---- search: typing filters the list at once; Enter runs the full search (words + meaning); "remember …" saves ----
  const [text, setText] = useState("");
  const [server, setServer] = useState<{ q: string; hits: Hit[] } | null>(null), [searching, setSearching] = useState(false), [saving, setSaving] = useState(false);
  const typed = text.trim(), intent = parseAsk(text), q = intent?.kind === "search" ? intent.q : "";
  useEffect(() => { const id = setTimeout(() => onQuery(q), 120); return () => clearTimeout(id); }, [q, onQuery]);
  const live = useMemo(() => withoutPending(stars ?? [], pending), [stars, pending]);
  const tags = useMemo(() => tagCounts(live), [live]);
  const n = useMemo(() => ({
    all: live.filter((m) => m.kind !== "journal").length, links: live.filter((m) => m.kind === "link").length,
    learned: live.filter((m) => isLearned(m.source)).length, journal: live.filter((m) => m.kind === "journal").length,
  }), [live]);
  const filtered = useMemo(() => {
    const f = filter;
    const base = f.k === "links" ? live.filter((m) => m.kind === "link") : f.k === "learned" ? live.filter((m) => isLearned(m.source))
      : f.k === "journal" ? live.filter((m) => m.kind === "journal") : f.k === "tag" ? live.filter((m) => m.tags.includes(f.v) || m.tags.includes(`scope:${f.v}`))
      : q ? live : live.filter((m) => m.kind !== "journal"); // search looks everywhere (journal rows match by date only)
    return q ? searchStars(base, q).map((i) => base[i]) : newestFirst(base);
  }, [live, filter, q]);
  const shownServer = server && q && server.q === q ? withoutPending(server.hits, pending) : null;
  const listRows: ListRow[] = shownServer ?? filtered;
  const groups = useMemo(() => (q ? null : groupByDay(listRows.slice(0, limit), lang)), [listRows, limit, lang, q]);
  useEffect(() => { setLimit(PAGE); }, [filter, q]);
  // the open memory: his pick, else the newest in the list (like opening a notes app)
  const current = openId && !pending.has(openId) ? openId : null;
  const shown = current ?? (filter.k !== "tags" ? listRows[0]?.id ?? null : null);
  const c = stars ? counts(stars) : null;
  const toMap = () => { if (!current && shown) onOpen(shown); onMode("map"); }; // the map centres on what he is reading
  const status = c ? [tn("overview.memories", total || c.n), c.today ? t("mp.today", { n: c.today }) : ""].filter(Boolean).join(" · ") : "";

  async function submit() {
    const a = parseAsk(text);
    if (!a || saving || searching || readOnly) return;
    uiSound("send");
    if (a.kind === "remember") {
      setSaving(true);
      const r = await call<{ memory?: { id?: string } }>("/api/memories", { method: "POST", body: JSON.stringify({ kind: "note", title: titleFrom(a.content), content: a.content, onDuplicate: "keep" }) }).catch(() => null);
      setSaving(false);
      if (!r?.ok) { toast({ text: r?.json.error && r.status < 500 ? r.json.error : t("mp.saveErr"), tone: "error" }); return; }
      setText(""); toast({ text: t("mp.saved"), tone: "done" }); onChanged();
      if (typeof r.json.memory?.id === "string") onOpen(r.json.memory.id);
      return;
    }
    setSearching(true);
    const r = await call<{ results?: unknown[] }>(`/api/memories?q=${encodeURIComponent(a.q)}`).catch(() => null);
    setSearching(false);
    if (!r?.ok) { toast({ text: t("mp.searchErr"), tone: "error" }); return; }
    setServer({ q: a.q, hits: normMemories(r.json.results).map((m) => ({ ...m, why: m.locked ? undefined : whyLine(m, a.q) })) });
  }
  const whyLine = (m: Mem, query: string) => { const w = whyMatched({ ...m, created_at: m.created_at ?? "" }, query); return w.by === "title" ? undefined : `${t(`memws.why.${w.by}` as Key)}: ${w.passage}`; };
  const kindName = useCallback((k: string) => ((KINDS as readonly string[]).includes(k) ? t(`mp.k.${k}` as Key) : k.charAt(0).toUpperCase() + k.slice(1)), [t]);

  const listRef = useRef<HTMLUListElement>(null);
  const onListKey = (e: KeyboardEvent) => { // arrows move through the list, like a notes app
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const ids = listRows.slice(0, limit).map((m) => m.id), i = ids.indexOf(shown ?? "");
    const next = ids[Math.max(0, Math.min(ids.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) { e.preventDefault(); onOpen(next); requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-id="${next}"]`)?.focus()); }
  };
  const item = (m: ListRow) => (
    <li key={m.id} role="none">
      <button type="button" role="option" aria-selected={shown === m.id} data-id={m.id} tabIndex={shown === m.id ? 0 : -1} className="mp-item" onClick={() => onOpen(m.id)}>
        <span className="mp-item-title">{isJournal(m) ? t("mp.journal") : m.title}</span>
        <span className="mp-item-sub">{q ? [dayLabel(m.created_at, lang), m.why ?? kindName(m.kind)].filter(Boolean).join(" · ") : timeLabel(m.created_at, lang) || kindName(m.kind)}</span>
      </button>
    </li>);

  const nav = (id: Filter["k"], icon: ReactNode, label: string, count: number | null, onClick?: () => void) => {
    const on = !onClick && (filter.k === id || (id === "tags" && filter.k === "tag"));
    return <li key={label}><button type="button" className="mp-nav-item" aria-current={on || undefined} onClick={onClick ?? (() => { setFilter({ k: id } as Filter); setServer(null); })}>
      {icon}<span>{label}</span>{count !== null && count > 0 && <span className="mp-nav-n pu-num">{count}</span>}</button></li>;
  };
  const menu: MenuItem[] = readOnly ? [] : [
    { label: t("mp.m.add"), onSelect: () => setSheet("add") },
    { label: t("mp.m.knows"), onSelect: () => setSheet("knows") },
    "separator",
    { label: t("mp.m.all"), onSelect: () => setSheet("all") },
  ];
  const sheetTitle: Record<SheetKind, string> = { add: t("mp.a.title"), review: t("mp.needs"), links: t("mp.links.sheet"), all: t("mp.m.all"), knows: t("mp.m.knows"), people: t("mp.m.people") };
  const [beliefs, setBeliefs] = useState(false);
  const del = (m: { id: string; title: string }) => {
    setPending((s) => new Set(s).add(m.id));
    if (openId === m.id) onOpen(null);
    timers.current.set(m.id, setTimeout(() => void sendDelete(m.id), UNDO_MS));
    toast({ id: `del-${m.id}`, text: t("mp.deleted", { t: m.title.length > 40 ? `${m.title.slice(0, 40)}…` : m.title }), action: { label: t("mp.undo"), onClick: () => {
      clearTimeout(timers.current.get(m.id)); timers.current.delete(m.id);
      setPending((s) => { const x = new Set(s); x.delete(m.id); return x; });
    } } });
  };
  const filterName = filter.k === "tag" ? `#${filter.v}` : filter.k === "links" ? t("mp.nav.links") : filter.k === "learned" ? t("mp.nav.learned") : filter.k === "journal" ? t("mp.nav.journal") : filter.k === "tags" ? t("mp.nav.tags") : "";

  return (
    <section className="pu pu-shell mp-shell" data-planet="memory" aria-label={t("mp.title")} data-open={current ? "" : undefined} data-mode={mode}>
      <header className="mp-top">
        <div className="mp-brand"><span className="pu-mark" aria-hidden="true" /><div className="pu-head-text"><h2 className="pu-title">{t("mp.title")}</h2><p className="pu-status">{status}</p></div></div>
        <form className="mp-search" role="search" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <IconSearch />
          <input className="mp-search-input" value={text} placeholder={t("mp.askPh")} aria-label={t("mp.askLabel")} maxLength={2000} enterKeyHint={intent?.kind === "remember" ? "done" : "search"}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape" && text) { e.preventDefault(); e.stopPropagation(); setText(""); setServer(null); } }} />
          {typed && !readOnly && <Button type="submit" size="sm" variant="primary" icon={intent?.kind === "remember" ? <IconPlus /> : <IconSend />} busy={saving || searching}>{intent?.kind === "remember" ? t("mp.saveIt") : t("mp.search")}</Button>}
        </form>
        <div className="pu-head-actions">
          <div className="mp-seg" role="group" aria-label={t("mp.view")}>
            <button type="button" aria-pressed={mode === "notes"} onClick={() => onMode("notes")}>{t("mp.view.notes")}</button>
            <button type="button" aria-pressed={mode === "map"} onClick={toMap}>{t("mp.view.map")}</button>
          </div>
          {menu.length > 0 && <MoreMenu items={menu} label={t("mp.menu")} />}
          <Button variant="ghost" icon={<IconClose />} label={t("mp.back")} onClick={onClose} className="world-back" />
        </div>
      </header>

      <div className="mp-cols">
        <nav className="mp-nav" aria-label={t("mp.nav.label")}>
          <ul>
            {nav("all", <IconNote />, t("mp.nav.notes"), n.all)}
            {nav("links", <IconBookmark />, t("mp.nav.links"), n.links)}
            {nav("learned", <IconSpark />, t("mp.nav.learned"), n.learned)}
            {n.journal > 0 && nav("journal", <IconLock />, t("mp.nav.journal"), n.journal)}
            {nav("tags", <IconTag />, t("mp.nav.tags"), tags.length)}
          </ul>
          <hr />
          <ul>
            {!readOnly && <li><button type="button" className="mp-nav-item" data-needs={needN ? "" : undefined} onClick={() => setSheet(suggested.length && !queue?.length ? "links" : "review")}>
              <IconInbox /><span>{t("mp.needs")}</span>{needN > 0 && <span className="mp-nav-n pu-num">{needN}</span>}</button></li>}
            {!readOnly && people && nav("all", <IconPeople />, t("mp.m.people"), people.count, () => { people.onOpen(); setSheet("people"); })}
            {nav("all", <IconMap />, t("mp.nav.map"), null, toMap)}
          </ul>
        </nav>

        <div className="mp-list">
          {!q && !readOnly && filter.k === "all" && first && <div className="mp-needs" role="group" aria-label={t("mp.needs")}>
            <p className="mp-needs-title">{t(`memrev.k.${first.kind}` as Key)}</p>
            <p className="mp-needs-sub">{first.items.map((x) => (x.subject ? `${x.subject}: ${x.text}` : x.title)).slice(0, 2).join(" · ")}</p>
            <div className="mp-needs-act">{quick ? <><Button size="sm" variant="ghost" disabled={!!busy} onClick={() => act(first, "snoozed")}>{t("mp.notNow")}</Button>
              <Button size="sm" variant="primary" busy={busy === first.key} onClick={() => act(first, "accepted")}>{t(`memrev.accept.${first.kind === "merge" ? "merge" : first.kind === "rerun" || first.kind === "version" ? "newest" : "keep"}` as Key)}</Button></>
              : <Button size="sm" onClick={() => setSheet("review")}>{t("mp.review")}</Button>}</div>
          </div>}
          {(filterName || q) && <div className="mp-list-head"><span>{q ? (shownServer ? t("mp.results") : t("mp.matches")) : filterName}</span><span className="pu-num mp-dim">{filter.k === "tags" && !q ? tags.length : listRows.length}</span>
            {filter.k !== "all" && !q && <button type="button" className="mp-clear" onClick={() => setFilter({ k: "all" })} aria-label={t("mp.nav.clear")}><IconClose /></button>}</div>}
          {err ? <div className="mp-pad"><ErrorState title={t("mp.err")} text={t("mp.errText")} retryLabel={t("mp.retry")} onRetry={onRetry} /></div>
            : !stars ? <div className="mp-pad"><Loading rows={5} label={t("mp.loading")} /></div>
            : filter.k === "tags" && !q ? (tags.length ? <ul className="mp-items">{tags.map(([tag, cnt]) => <li key={tag}><button type="button" className="mp-item mp-tag" onClick={() => setFilter({ k: "tag", v: tag })}><span className="mp-item-title">#{tag}</span><span className="mp-item-sub pu-num">{cnt}</span></button></li>)}</ul>
              : <div className="mp-pad"><Empty title={t("mp.noTags")} /></div>)
            : !listRows.length ? <div className="mp-pad">{q ? <Empty title={t("mp.noMatch")} text={shownServer ? t("mp.noMatchServer") : t("mp.noMatchText")} />
              : <Empty title={t("mp.empty")} text={t("mp.emptyText")} action={readOnly ? undefined : <Button size="sm" icon={<IconPlus />} onClick={() => setSheet("add")}>{t("mp.m.add")}</Button>} />}</div>
            : <ul className="mp-items" role="listbox" aria-label={t("mp.list")} ref={listRef} onKeyDown={onListKey}>
              {groups ? groups.map((g) => <li key={g.key} role="presentation" className="mp-group"><p className="mp-day" aria-hidden="true">{g.label}</p><ul role="group" aria-label={g.label}>{g.items.map(item)}</ul></li>)
                : listRows.slice(0, limit).map(item)}
              {listRows.length > limit && <li role="none" className="mp-more"><Button size="sm" variant="ghost" onClick={() => setLimit((x) => x + PAGE)}>{t("mp.more", { n: listRows.length - limit })}</Button></li>}
            </ul>}
          {q && <p className="pu-sr" role="status">{t("mp.matchCount", { n: listRows.length })}</p>}
        </div>

        <article className="mp-pane" aria-label={t("mp.open")}>
          {shown ? <Detail key={shown} id={shown} readOnly={readOnly} stars={stars ?? []} links={links} edges={edges} kindName={kindName}
            onOpen={(id) => onOpen(id)} onFly={onFly} onBack={() => onOpen(null)} onDelete={del} onGone={() => { onOpen(null); onChanged(); }}
            onSaved={(m) => { onPatched(m.id, { title: m.title, tags: m.tags }); setServer((s) => s && { ...s, hits: s.hits.map((h) => (h.id === m.id ? { ...h, title: m.title, tags: m.tags } : h)) }); }} onChanged={onChanged} />
            : stars && <div className="mp-pad"><Empty title={t("mp.pickOne")} /></div>}
        </article>
      </div>

      <Sheet open={!!sheet} title={sheet ? sheetTitle[sheet] : ""} onClose={() => setSheet(null)} closeLabel={t("mp.close")}>
        {sheet === "add" && <AddForm kindName={kindName} onDone={(id) => { setSheet(null); onChanged(); if (id) onOpen(id); }} />}
        {sheet === "review" && <>
          {suggested.length > 0 && <Card tone="needs" title={tn("mp.links.title", suggested.length)} sub={t("mp.links.text")} actions={<Button size="sm" variant="primary" onClick={() => setSheet("links")}>{t("mp.links.check")}</Button>} />}
          <MemoryReview onChanged={() => { onChanged(); void loadNeeds(); }} />
          {!needN && <Empty title={t("mp.needsNone")} text={t("mp.needsNoneText")} />}
        </>}
        {sheet === "links" && (suggested.length ? <ul className="mp-rules">{suggested.map((l) => (
          <li key={l.id} className="mp-needs"><p className="mp-needs-title">{l.from?.title} <span className="mp-dim">↔</span> {l.to?.title}</p><p className="mp-needs-sub">{t("mp.d.similar", { p: Math.round((l.score ?? 0) * 100) })}</p>
            <div className="mp-needs-act"><Button size="sm" variant="ghost" onClick={() => decideLink(l.id, "rejected")}>{t("mp.links.no")}</Button><Button size="sm" variant="primary" onClick={() => decideLink(l.id, "confirmed")}>{t("mp.links.yes")}</Button></div></li>))}</ul>
          : <Empty title={t("mp.links.none")} />)}
        {sheet === "knows" && (beliefs ? <BeliefsPanel onBack={() => setBeliefs(false)} /> : <KnowsPanel onBack={() => setSheet(null)} onBeliefs={() => setBeliefs(true)} />)}
        {sheet === "all" && List && <div className="mp-legacy"><List focusId={null} onChanged={onChanged} /></div>}
        {sheet === "people" && people?.node}
      </Sheet>
    </section>
  );
});

/** The open memory: big title, when + kind, tags, readable text, Related on hairlines; edit in place, Save when changed. */
function Detail({ id, readOnly, stars, links, edges, kindName, onOpen, onFly, onBack, onDelete, onGone, onSaved, onChanged }: {
  id: string; readOnly: boolean; stars: Star[]; links: { from: string; to: string }[]; edges: [number, number, number][]; kindName: (k: string) => string;
  onOpen: (id: string) => void; onFly: (id: string) => void; onBack: () => void; onDelete: (m: { id: string; title: string }) => void; onGone: () => void; onSaved: (m: Mem) => void; onChanged: () => void;
}) {
  const { t, lang } = useT();
  const [m, setM] = useState<Mem | null>(null), [err, setErr] = useState(false), [draft, setDraft] = useState({ title: "", content: "", tags: "" }), [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false), [pick, setPick] = useState(""), [why, setWhy] = useState<{ id: string; title: string; source: string }[] | null>(null);
  const star = useMemo(() => stars.find((s) => s.id === id), [stars, id]);
  const load = useCallback(async () => {
    setErr(false);
    if (readOnly) { // demo: what the star itself carries, nothing fetched
      const x = star ? normMemory({ ...star, content: "" }) : null;
      if (x) { setM(x); setDraft({ title: x.title, content: "", tags: shownTags(x).join(", ") }); } else setErr(true);
      return;
    }
    const r = await call<{ memory?: unknown }>(`/api/memories/${id}`).catch(() => null);
    const x = r?.ok ? normMemory(r.json.memory) : null;
    if (!x) { setErr(true); return; }
    setM(x); setDraft({ title: x.title, content: x.content, tags: shownTags(x).join(", ") });
  }, [id, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps -- star: read once per opened memory
  useEffect(() => { void load(); }, [load]);
  const index = useMemo(() => new Map(stars.map((s, i) => [s.id, i])), [stars]);
  const conns = useMemo(() => { const i = index.get(id); return i === undefined ? [] : connections(i, stars, links, edges).slice(0, 8).map((x) => ({ ...x, s: stars[x.i] })); }, [index, id, stars, links, edges]);
  const pickHits = useMemo(() => { if (!pick.trim()) return []; const linked = new Set(conns.filter((x) => x.kind === "explicit").map((x) => x.s.id)); return searchStars(stars, pick).map((i) => stars[i]).filter((s) => s.id !== id && !linked.has(s.id) && s.kind !== "journal").slice(0, 6); }, [pick, stars, id, conns]);
  const body = useRef<HTMLTextAreaElement>(null), head = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { for (const el of [body.current, head.current]) if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight + 2}px`; } }, [draft.content, draft.title, m]);

  if (err) return <div className="mp-pad"><ErrorState title={t("mp.d.loadErr")} text={t("mp.errText")} retryLabel={t("mp.retry")} onRetry={load} /></div>;
  if (!m) return <div className="mp-pad"><Loading rows={4} label={t("mp.loading")} /></div>;
  const keepProv = m.tags.filter((x) => !shownTags(m).includes(x)); // fp:/via:/scope: tags stay when he edits the visible ones
  const project = m.tags.find((x) => x.startsWith("scope:"))?.slice(6);
  const dirty = !m.locked && !readOnly && (draft.title.trim() !== m.title || draft.content !== m.content || draft.tags !== shownTags(m).join(", "));
  const when = m.created_at ? t("mp.d.when", { d: dayLabel(m.created_at, lang), t: timeLabel(m.created_at, lang) }) : "";
  async function save() {
    if (!m || !draft.title.trim() || !dirty) return;
    setSaving(true);
    const patch = { title: draft.title.trim(), content: draft.content, tags: [...keepProv, ...tagsFromText(draft.tags)] };
    const r = await call<{ memory?: unknown }>(`/api/memories/${m.id}`, { method: "PATCH", body: JSON.stringify(patch) }).catch(() => null);
    setSaving(false);
    if (!r?.ok) { toast({ text: r?.json.error && r.status < 500 ? r.json.error : t("mp.saveErr"), tone: "error" }); return; }
    const x = normMemory(r.json.memory) ?? { ...m, ...patch };
    setM(x); setDraft({ title: x.title, content: x.content, tags: shownTags(x).join(", ") }); onSaved(x);
    toast({ id: `save-${m.id}`, text: t("mp.saved"), tone: "done" });
  }
  async function link(to: Star) {
    const r = await call("/api/links", { method: "POST", body: JSON.stringify({ from: id, to: to.id }) }).catch(() => null);
    if (!r?.ok) { toast({ text: t("mp.linkErr"), tone: "error" }); return; }
    setPicking(false); setPick(""); toast({ text: t("mp.linkedTo", { t: to.title }), tone: "done" }); onChanged();
  }
  async function control(action: "why" | "forget" | "confirm") {
    const r = await call<{ sources?: { id: string; title: string; source: string }[] }>(`/api/memories/${id}/control`, { method: "POST", body: JSON.stringify({ action }) }).catch(() => null);
    if (!r?.ok) { toast({ text: t("mp.saveErr"), tone: "error" }); return; }
    if (action === "why") setWhy((r.json.sources ?? []).filter((s) => s.id !== id));
    if (action === "confirm") { setM({ ...m!, confirmation: "confirmed" }); toast({ text: t("mp.saved"), tone: "done" }); }
    if (action === "forget") { toast({ text: t("mp.d.forgotten"), tone: "done" }); onGone(); }
  }
  const menu: MenuItem[] = [
    { label: t("mp.d.showMap"), onSelect: () => onFly(id), disabled: !index.has(id) },
    ...(m.locked || readOnly ? [] : [{ label: t("mp.d.why"), onSelect: () => void control("why") }]),
    ...(m.url ? [{ label: t("mp.d.openLink"), onSelect: () => window.open(m.url!, "_blank", "noopener,noreferrer") }] : []),
    ...(m.storage_path ? [{ label: t("mp.d.openFile"), onSelect: () => window.open(`/api/memories/${id}/file`, "_blank", "noreferrer") }] : []),
    ...(readOnly ? [] : ["separator" as const, ...(m.locked ? [] : [{ label: t("mp.d.forget"), danger: true, onSelect: async () => { if ((await askConfirm(t("mp.d.forgetConfirm")))) void control("forget"); } }]),
      { label: t("mp.delete"), danger: true, onSelect: () => onDelete({ id: m.id, title: m.locked ? t("mp.journal") : m.title }) }]),
  ];
  return (
    <div className="mp-doc" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } }}>
      <div className="mp-doc-top">
        <Button variant="ghost" size="sm" icon={<IconBack />} className="mp-back" onClick={onBack}>{t("mp.list")}</Button>
        <span className="mp-doc-spacer" />
        {dirty && <><Button size="sm" variant="ghost" onClick={() => setDraft({ title: m.title, content: m.content, tags: shownTags(m).join(", ") })}>{t("mp.cancel")}</Button>
          <Button size="sm" variant="primary" busy={saving} disabled={!draft.title.trim()} onClick={() => void save()}>{t("mp.save")}</Button></>}
        <MoreMenu items={menu} label={t("mp.d.actions")} />
      </div>
      {m.locked ? <><h3 className="mp-doc-title">{t("mp.journal")}</h3><p className="mp-doc-meta">{when}</p><p className="mp-doc-note">{t("mp.journalNote")}</p></>
        : readOnly ? <><h3 className="mp-doc-title">{m.title}</h3><p className="mp-doc-meta">{[when, kindName(m.kind)].filter(Boolean).join(" · ")}</p></>
        : <>
          <textarea ref={head} className="mp-doc-title mp-edit" rows={1} value={draft.title} maxLength={300} aria-label={t("mp.f.title")} onChange={(e) => setDraft({ ...draft, title: e.target.value.replace(/\n/g, " ") })} />
          <p className="mp-doc-meta">
            {[when, kindName(m.kind), isLearned(m.source) ? t("mp.d.learned") : ""].filter(Boolean).join(" · ")}
            {project && <> · {t("mp.d.project")} <span className="mp-chip">{project}</span></>}
          </p>
          {m.confirmation === "suggested" && <p className="mp-doc-note">{t("mp.d.suggested")} <Button size="sm" variant="ghost" onClick={() => void control("confirm")}>{t("mp.d.confirm")}</Button></p>}
          <label className="mp-tagline"><span>{t("mp.f.tags")}</span><input className="mp-edit mp-tags-in" value={draft.tags} placeholder={t("mp.f.tagsPh")} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} /></label>
          <textarea ref={body} className="mp-doc-body mp-edit" value={draft.content} placeholder={t("mp.f.textPh")} aria-label={t("mp.f.text")} maxLength={200000} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
        </>}
      {why && <section className="mp-related"><h4>{t("mp.d.sources")}</h4>{why.length ? <ul>{why.map((s) => <li key={s.id}><button type="button" className="mp-rel" onClick={() => onOpen(s.id)}><span className="mp-rel-i"><IconNote /></span><span className="mp-rel-t">{s.title}</span><span className="mp-rel-d">{s.source}</span></button></li>)}</ul> : <p className="mp-doc-note">{t("mp.d.noSource")}</p>}</section>}
      <section className="mp-related" aria-labelledby={`rel-${id}`}>
        <div className="mp-related-head"><h4 id={`rel-${id}`}>{t("mp.d.connections")}</h4>{!m.locked && !readOnly && <Button size="sm" variant="ghost" aria-expanded={picking} onClick={() => setPicking(!picking)}>{t("mp.link")}</Button>}</div>
        {picking && <div className="mp-link-pick">
          <input className="mp-input" type="search" autoFocus value={pick} placeholder={t("mp.linkPh")} aria-label={t("mp.linkPh")} onChange={(e) => setPick(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setPicking(false); } }} />
          {pickHits.length > 0 && <ul className="pu-list">{pickHits.map((s) => <li key={s.id}><Row title={s.title} sub={kindName(s.kind)} lead={<IconPlus />} onClick={() => void link(s)} /></li>)}</ul>}
        </div>}
        {conns.length ? <ul>{conns.map((x) => <li key={x.s.id}><button type="button" className="mp-rel" onClick={() => onOpen(x.s.id)}>
          <span className="mp-rel-i" style={{ color: kindColor(x.s.kind) }}>{kindIcon(x.s.kind)}</span><span className="mp-rel-t">{x.s.kind === "journal" ? t("mp.journal") : x.s.title}</span>
          <span className="mp-rel-d">{[x.kind === "explicit" ? t("mp.d.linked") : t("mp.d.similar", { p: Math.round((x.sim ?? 0) * 100) }), dayLabel(x.s.created_at, lang)].filter(Boolean).join(" · ")}</span></button></li>)}</ul>
          : !picking && <p className="mp-doc-note">{t("mp.d.noConn")}</p>}
      </section>
    </div>
  );
}

type DupState = { duplicate: React.ComponentProps<typeof DupPreview>["dup"]; preview: React.ComponentProps<typeof DupPreview>["preview"] };
/** Add with details: text, optional title, kind, tags and link, or a file. A repeat asks keep / merge / update (MEM04). */
function AddForm({ kindName, onDone }: { kindName: (k: string) => string; onDone: (id?: string) => void }) {
  const { t } = useT();
  const [f, setF] = useState({ content: "", title: "", kind: "note" as Kind, tags: "", url: "" }), [saving, setSaving] = useState(false);
  const [dup, setDup] = useState<(DupState & { again: (c: DupChoice) => void }) | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const can = !!(f.content.trim() || f.url.trim() || f.title.trim());
  async function save(choice?: DupChoice) {
    setSaving(true); setDup(null);
    const r = await call<{ preview?: unknown; memory?: { id?: string } }>("/api/memories", { method: "POST", body: JSON.stringify({ ...f, tags: tagsFromText(f.tags), onDuplicate: choice }) }).catch(() => null);
    setSaving(false);
    if (r?.status === 409 && r.json.preview) { setDup({ ...(r.json as unknown as DupState), again: (c: DupChoice) => void save(c) }); return; }
    if (!r?.ok) { toast({ text: r?.json.error && r.status < 500 ? r.json.error : t("mp.saveErr"), tone: "error" }); return; }
    toast({ text: t("mp.saved"), tone: "done" }); onDone(typeof r.json.memory?.id === "string" ? r.json.memory.id : undefined);
  }
  async function upload(file: File, choice?: DupChoice) {
    setSaving(true); setDup(null);
    const fd = new FormData(); fd.set("file", file);
    if (f.title.trim()) fd.set("title", f.title.trim());
    if (f.content.trim()) fd.set("note", f.content.trim());
    if (f.tags.trim()) fd.set("tags", f.tags);
    if (choice) fd.set("onDuplicate", choice);
    const r = await call<{ preview?: unknown }>("/api/memories/upload", { method: "POST", body: fd }).catch(() => null);
    setSaving(false); if (fileRef.current) fileRef.current.value = "";
    if (r?.status === 409 && r.json.preview) { setDup({ ...(r.json as unknown as DupState), again: (c: DupChoice) => void upload(file, c) }); return; }
    if (!r?.ok) { toast({ text: r?.json.error && r.status < 500 ? r.json.error : t("mp.saveErr"), tone: "error" }); return; }
    toast({ text: t("mp.saved"), tone: "done" }); onDone();
  }
  return (
    <form className="mp-detail" onSubmit={(e) => { e.preventDefault(); if (can) void save(); }}>
      <label className="mp-field"><span>{t("mp.f.what")}</span><textarea className="mp-input mp-text" autoFocus value={f.content} maxLength={200000} onChange={(e) => setF({ ...f, content: e.target.value })} /></label>
      <label className="mp-field"><span>{t("mp.f.titleOpt")}</span><input className="mp-input" value={f.title} maxLength={300} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <div className="mp-two">
        <label className="mp-field"><span>{t("mp.f.kind")}</span><select className="mp-input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Kind })}>
          {KINDS.filter((k) => k !== "journal" && k !== "episode").map((k) => <option key={k} value={k}>{kindName(k)}</option>)}</select></label>
        <label className="mp-field"><span>{t("mp.f.tags")}</span><input className="mp-input" value={f.tags} placeholder={t("mp.f.tagsPh")} onChange={(e) => setF({ ...f, tags: e.target.value })} /></label>
      </div>
      <label className="mp-field"><span>{t("mp.f.url")}</span><input className="mp-input" type="url" inputMode="url" value={f.url} placeholder="https://" onChange={(e) => setF({ ...f, url: e.target.value })} /></label>
      {dup && <DupPreview dup={dup.duplicate} preview={dup.preview} onChoose={dup.again} onCancel={() => setDup(null)} />}
      <div className="mp-actions">
        <label className="pu-btn mp-file" data-variant="ghost" aria-disabled={saving || undefined}>
          {t("mp.upload")}<input ref={fileRef} type="file" className="pu-sr" disabled={saving} title={t("mp.uploadHint")}
            accept=".pdf,.docx,.txt,.md,.csv,image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { const x = e.target.files?.[0]; if (x) void upload(x); }} />
        </label>
        <Button type="submit" variant="primary" busy={saving} disabled={!can}>{t("mp.save")}</Button>
      </div>
      <p className="pu-row-sub">{t("mp.uploadHint")}</p>
    </form>
  );
}
