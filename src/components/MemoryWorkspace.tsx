"use client";
// MEMORY workspace views (MEM01/MEM02): Search with filters and "why it matched", Projects, People, and the inspector card on an
// open memory. Pure rules: lib/memory-workspace-pure.ts. Everything runs on rows already loaded for the owner; no model calls.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useT } from "./i18n";
import { applyFilters, inspect, NO_FILTERS, projects, whyMatched, type Filters, type Mem } from "@/lib/memory-workspace-pure";
import type { MemoryType } from "@/lib/memory-types-pure";
import type { Key } from "@/lib/i18n-pure";
import { mergedContent } from "@/lib/memory-hygiene-pure";
import type { Decision, RItem } from "@/lib/memory-review-pure";
import type { Dup, DupChoice } from "@/lib/memory-capture-pure";
import { SECTIONS, type Pack } from "@/lib/memory-pack-pure";

const TYPES: MemoryType[] = ["preference", "fact", "temporary", "observation", "inferred", "superseded"];
const day = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

// The people list loads three.js with the ring module: only when People is opened.
export const PeopleView = dynamic(() => import("./PeopleRing").then((m) => ({ default: function People() { return <m.PeoplePanel st={m.usePeople(true)} />; } })), { ssr: false });

export function MemorySearch<T extends Mem>({ recent, hits, searched, mode, onSearch, row, children }: {
  recent: T[]; hits: T[]; searched: string; mode: string; onSearch: (q: string) => void; row: (m: T, why?: ReactNode) => ReactNode; children?: ReactNode;
}) {
  const { t } = useT();
  const [q, setQ] = useState(searched);
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const base = searched ? hits : recent;
  const shown = useMemo(() => applyFilters(base, f), [base, f]);
  const names = useMemo(() => projects(recent).map((p) => p.name), [recent]);
  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="space-y-2">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); onSearch(q.trim()); }}>
        <input className="field flex-1" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("mem.searchPh")} aria-label={t("mem.searchAria")} />
        <button className="btn">{t("mem.search")}</button>
      </form>
      <div className="flex flex-wrap gap-2 text-xs" role="group" aria-label={t("memws.filters")}>
        <select className="field" value={f.project} onChange={set("project")} aria-label={t("memws.project")}><option value="">{t("memws.anyProject")}</option>{names.map((n) => <option key={n}>{n}</option>)}</select>
        <select className="field" value={f.type} onChange={set("type")} aria-label={t("memws.type")}><option value="">{t("memws.anyType")}</option>{TYPES.map((x) => <option key={x} value={x}>{t(`memws.t.${x}` as Key)}</option>)}</select>
        <select className="field" value={f.scope} onChange={set("scope")} aria-label={t("memws.scope")}><option value="">{t("memws.anyScope")}</option>{(["global", "project", "chat"] as const).map((x) => <option key={x} value={x}>{t(`memws.s.${x}` as Key)}</option>)}</select>
        <label className="flex items-center gap-1">{t("memws.from")}<input className="field" type="date" value={f.from} onChange={set("from")} /></label>
        <label className="flex items-center gap-1">{t("memws.to")}<input className="field" type="date" value={f.to} onChange={set("to")} /></label>
        {children}
      </div>
      {searched && mode && <p className="muted text-xs">{t(mode === "hybrid" ? "mem.hybrid" : mode === "hybrid-journal-keyword" ? "mem.hybridJournalKeyword" : "mem.keyword")}</p>}
      <ul className="space-y-2" aria-live="polite">
        {shown.map((m) => {
          const w = searched ? whyMatched(m, searched) : null;
          return <li key={m.id}>{row(m, w && <div className="mt-1 text-[11px]"><span className="muted">{t(`memws.why.${w.by}` as Key)}: </span>{w.passage}</div>)}</li>;
        })}
        {!shown.length && <li className="muted">{t(searched ? "mem.noMatch" : "mem.empty")}</li>}
      </ul>
    </div>
  );
}

export function MemoryProjects<T extends Mem>({ items, row }: { items: T[]; row: (m: T) => ReactNode }) {
  const { t } = useT();
  const groups = useMemo(() => projects(items), [items]);
  if (!groups.length) return <p className="muted">{t("memws.noProjects")}</p>;
  return <div className="space-y-3">{groups.map((g) => (
    <details key={g.name} className="space-y-2"><summary className="h3 cursor-pointer">{g.name} <span className="muted text-xs">{g.items.length}</span></summary>
      <HandoverPack project={g.name} />
      <ul className="space-y-2">{(g.items as T[]).map((m) => <li key={m.id}>{row(m)}</li>)}</ul></details>
  ))}</div>;
}

type PackView = { saved: Pack | null; current: Pack; outdatedSince: string | null };
/** MEM08: the project's handover pack, its saved revision and whether linked memories changed since. Built on open only. */
function HandoverPack({ project }: { project: string }) {
  const { t } = useT();
  const [v, setV] = useState<PackView | null>(null);
  const [err, setErr] = useState("");
  const q = `/api/memories/pack?project=${encodeURIComponent(project)}`;
  const run = (p: Promise<PackView>) => p.then((x) => { setV(x); setErr(""); }, (e: Error) => setErr(e.message));
  return (
    <details className="card space-y-2 text-xs" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !v) void run(call(q)); }}>
      <summary className="cursor-pointer"><b>{t("pack.open")}</b>{v && <span className="muted"> · {v.saved ? t("pack.rev", { n: v.saved.rev }) : t("pack.unsaved")}</span>}
        {v?.outdatedSince && <span className="warn"> · {t("pack.outdated", { d: day(v.outdatedSince) })}</span>}</summary>
      {err && <p className="error" role="alert">{err}</p>}
      {v && <>
        <p className="muted">{t("pack.guard")}</p>
        {!v.current.sources.length ? <p className="muted">{t("pack.empty")}</p> : <>
          {SECTIONS.map((s) => !!v.current[s].length && <div key={s}><b>{t(`pack.s.${s}` as Key)}</b>
            <ul>{v.current[s].map((l) => <li key={l.id} className="line-clamp-2">· {l.text}</li>)}</ul></div>)}
          {!!v.current.files.length && <div><b>{t("pack.files")}</b><ul>{v.current.files.map((f) => <li key={f.vault} className="num">· vault:{f.vault}</li>)}</ul></div>}
        </>}
        {v.saved && v.saved.hash !== v.current.hash && <p className="warn">{t("pack.changed", { n: v.saved.rev })}</p>}
        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={!v.current.sources.length || v.saved?.hash === v.current.hash} onClick={() => run(call("/api/memories/pack", { method: "POST", body: JSON.stringify({ project }) }))}>{t("pack.save")}</button>
          <a className="chip" href={`${q}&format=md`} download>{t("pack.export")}</a>
        </div>
      </>}
    </details>
  );
}

/** Where a memory came from and how far to trust it. Unknown or no-longer-stored sources are said out loud. */
export function MemoryInspector({ m }: { m: Mem }) {
  const { t } = useT();
  const i = inspect(m);
  const rows: [string, ReactNode][] = [
    [t("memws.origin"), i.source === "unknown" ? <em>{t("memws.unknown")}</em> : i.source],
    [t("memws.captured"), day(i.capturedAt)],
    [t("memws.who"), `${t(`memws.st.${i.stated}` as Key)} · ${t(`memws.t.${i.type}` as Key)}`],
    [t("memws.scope"), `${t(`memws.s.${i.scope.kind}` as Key)}${i.scope.where ? ` · ${i.scope.where}` : ""}${i.scope.expiresAt ? ` · ${t("memws.until", { d: day(new Date(i.scope.expiresAt).toISOString()) })}` : ""}`],
    [t("memws.linked"), i.link.missing ? <em>{t("memws.missing")}</em> : i.link.file || i.link.url
      ? <>{i.link.file && <a className="link" href={`/api/memories/${m.id}/file`} target="_blank" rel="noreferrer">{t("mem.openFile")}</a>}{i.link.file && i.link.url && " · "}{i.link.url && <a className="link" href={i.link.url} target="_blank" rel="noreferrer noopener">{t("mem.openLink")}</a>}</>
      : <span className="muted">{t("memws.none")}</span>],
  ];
  return (
    <dl className="card grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs" aria-label={t("memws.inspector")}>
      {rows.map(([k, v]) => <div key={k} className="contents"><dt className="muted">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>)}
    </dl>
  );
}

/** MEM04: a capture repeats an existing memory. Nothing was saved; the owner picks keep both, merge or update. */
export function DupPreview({ dup, preview, onChoose, onCancel }: {
  dup: Dup; preview: { existing: string; merged: string; changes: boolean }; onChoose: (c: DupChoice) => void; onCancel: () => void;
}) {
  const { t } = useT();
  return (
    <div className="card space-y-2" role="alertdialog" aria-label={t("memcap.title")}>
      <b>{t(dup.by === "source" ? "memcap.bySource" : "memcap.byContent", { title: dup.title })}</b>
      <p className="muted text-xs">{t(preview.changes ? "memcap.mergeAdds" : "memcap.mergeSame")}</p>
      <pre className="field max-h-40 overflow-auto whitespace-pre-wrap text-xs">{preview.merged}</pre>
      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={() => onChoose("merge")}>{t("memcap.merge")}</button>
        <button className="chip" onClick={() => onChoose("update")}>{t("memcap.update")}</button>
        <button className="chip" onClick={() => onChoose("keep")}>{t("memcap.keep")}</button>
        <button className="link text-xs" onClick={onCancel}>{t("memcap.cancel")}</button>
      </div>
    </div>
  );
}

async function call(url: string, init?: RequestInit, okIf404 = false) {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !(okIf404 && r.status === 404)) throw new Error(j.error || `Failed (${r.status})`);
  return j;
}
const control = (id: string, body: object) => call(`/api/memories/${id}/control`, { method: "POST", body: JSON.stringify(body) });
const fact = (body: object) => call("/api/facts", { method: "POST", body: JSON.stringify(body) });

/** Runs the owner's decision on the record it belongs to; history is never lost (Correct keeps the original as history). */
async function apply(it: RItem, d: Decision, text: string) {
  const [a, b] = it.items, k = it.kind;
  if (it.target === "entity" && d !== "snoozed") // recorded by the entity check itself; it drops the item from its list
    return void await call("/api/memories/entities", { method: "POST", body: JSON.stringify({ key: it.key, choice: text || (d === "accepted" ? "same" : k === "entity-same" ? "different" : "skip") }) });
  if (d === "accepted" && (k === "rerun" || k === "version")) { // archive the older one: out of retrieval, kept as history
    const y = await call(`/api/memories/${b.id}`);
    await call(`/api/memories/${b.id}`, { method: "PATCH", body: JSON.stringify({ tags: [...(y.memory.tags ?? []), "superseded"] }) });
  } else if (d === "accepted") {
    if (k === "merge") {
      const [x, y] = await Promise.all([call(`/api/memories/${a.id}`), call(`/api/memories/${b.id}`)]);
      const content = mergedContent(String(x.memory.content ?? ""), String(y.memory.content ?? ""));
      if (content !== null) await call(`/api/memories/${a.id}`, { method: "PATCH", body: JSON.stringify({ content }) });
      await call(`/api/memories/${b.id}`, { method: "DELETE" }, true);
    } else if (it.target === "fact") await (k === "inferred-belief" ? fact({ action: "edit", id: a.id, subject: a.subject, statement: a.text }) : fact({ action: "wrong", id: a.id }));
    else await control(a.id, { action: "confirm" }).catch(() => null); // before 0019 there is no confirmation to set
  }
  if (d === "corrected") {
    if (it.target === "fact") await fact({ action: "edit", id: a.id, subject: a.subject, statement: text });
    else {
      await control(a.id, { action: "correct", content: text });
      if (k === "merge") { // the second one stays as history, out of retrieval
        const y = await call(`/api/memories/${b.id}`);
        await call(`/api/memories/${b.id}`, { method: "PATCH", body: JSON.stringify({ tags: [...(y.memory.tags ?? []), "superseded"] }) });
      }
    }
  }
  if (d === "dismissed" && k === "inferred-belief") await fact({ action: "wrong", id: a.id }); // a discarded guess stops being believed (history kept)
  await call("/api/memories/hygiene", { method: "POST", body: JSON.stringify({ key: it.key, decision: d }) });
}

/** V05: why it was proposed, what each side says (changed facts flagged), the class and what a merge would keep. */
function MergeDetail({ m }: { m: NonNullable<RItem["merge"]> }) {
  const { t } = useT();
  return (
    <div className="space-y-1 text-xs">
      {m.cls && <span className="chip text-[10px]">{t(`ent.cls.${m.cls}` as Key)}</span>}
      {!!m.evidence?.length && <ul className="muted text-[11px]" aria-label={t("ent.why")}>{m.evidence.map((e, i) => <li key={i}>{t(`ent.ev.${e.code}` as Key, { a: e.a, b: e.b })}</li>)}</ul>}
      {m.sides && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{m.sides.map((sd, i) => (
        <div key={i} className="min-w-0">
          <b className="truncate block">{sd.form}</b>
          {sd.srcs.map((x, j) => <div key={j} className="muted truncate">{x.title} · {x.at.slice(0, 10)}</div>)}
          {sd.facts.map((f) => <div key={f.attr} className={f.conflict ? "error" : undefined}>{t(`ent.attr.${f.attr}` as Key)}: {f.value} <span className="muted">· {f.at.slice(0, 10)}</span></div>)}
          {!sd.facts.length && <div className="muted">{t("ent.noFacts")}</div>}
        </div>))}</div>}
      {m.keep && <p><span className="muted">{t("ent.keep")}</span> <b>{m.keep.name}</b>{m.keep.facts.map((f) => ` · ${t(`ent.attr.${f.attr}` as Key)}: ${f.value}`).join("")}
        {m.keep.ask.map((a) => <span key={a} className="error"> · {t(`ent.attr.${a}` as Key)}: {t("ent.youChoose")}</span>)}</p>}
    </div>
  );
}

/** MEM05: the one review queue (top 5): merges, guesses, contradictions and stale project knowledge. */
export function MemoryReview({ onChanged }: { onChanged: () => void }) {
  const { t } = useT();
  const [list, setList] = useState<RItem[] | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [fix, setFix] = useState<{ key: string; text: string } | null>(null);
  const load = useCallback(() => call("/api/memories/hygiene").then((j) => setList(j.queue ?? []), (e: Error) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  async function act(it: RItem, d: Decision, text = "") {
    setBusy(it.key); setErr("");
    try { await apply(it, d, text); setFix(null); if (d !== "snoozed") onChanged(); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }
  if (!list?.length && !err) return null;
  return (
    <div className="card space-y-2" aria-label={t("memrev.title")}>
      <div className="muted text-[10px] uppercase tracking-widest">{t("memrev.title")}</div>
      {err && <p className="error" role="alert">{err}</p>}
      <ul className="space-y-3">{(list ?? []).map((it) => (
        <li key={it.key} className="space-y-1">
          <b>{it.merge?.relation === "related" ? t("ent.related") : it.kind === "entity-which" ? t("ent.which", { who: it.who === "me" ? t("ent.me") : it.who ?? "", attr: t(`ent.attr.${it.attr}` as Key) }) : t(`memrev.k.${it.kind}` as Key)}</b>
          <ul className="text-xs">{it.items.map((x) => <li key={x.id} className="line-clamp-2">· {x.subject ? `${x.subject}: ${x.text}` : x.title}
            {it.kind === "entity-which" && <button className="chip ml-2" onClick={() => act(it, "accepted", x.id)} disabled={!!busy} aria-label={`${t("ent.pick")}: ${x.text}`}>{t("ent.pick")}</button>}</li>)}</ul>
          {it.merge && <MergeDetail m={it.merge} />}
          {it.kind === "entity-merged" ? <button className="chip" onClick={() => act(it, "accepted", "undo")} disabled={!!busy}>{busy === it.key ? t("memrev.working") : t("ent.undo")}</button> : fix?.key === it.key ? (
            <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); if (fix.text.trim()) void act(it, "corrected", fix.text.trim()); }}>
              <textarea className="field h-24 w-full" value={fix.text} onChange={(e) => setFix({ ...fix, text: e.target.value })} aria-label={t("memrev.correct")} />
              <p className="muted text-[11px]">{t("memrev.history")}</p>
              <div className="flex gap-2"><button className="btn" disabled={!!busy}>{t("memrev.save")}</button><button type="button" className="chip" onClick={() => setFix(null)}>{t("memcap.cancel")}</button></div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              {it.kind !== "entity-which" && <button className="btn" onClick={() => act(it, "accepted")} disabled={!!busy}>{busy === it.key ? t("memrev.working") : it.kind === "entity-same" ? t("ent.yes") : t(`memrev.accept.${it.target === "fact" && it.kind !== "inferred-belief" ? "retract" : it.kind === "merge" ? "merge" : it.kind === "rerun" || it.kind === "version" ? "newest" : "keep"}` as Key)}</button>}
              {it.target !== "entity" && it.kind !== "rerun" && it.kind !== "version" && <button className="chip" onClick={() => setFix({ key: it.key, text: it.kind === "merge" ? mergedContent(it.items[0].text, it.items[1]?.text ?? "") ?? it.items[0].text : it.items[0].text })} disabled={!!busy}>{t("memrev.correct")}</button>}
              <button className="chip" onClick={() => act(it, "snoozed")} disabled={!!busy}>{t("memrev.snooze")}</button>
              <button className="chip" onClick={() => act(it, "dismissed")} disabled={!!busy}>{t(it.kind === "entity-same" ? "ent.no" : it.kind === "entity-which" ? "ent.skip" : "memrev.discard")}</button>
            </div>
          )}
        </li>))}</ul>
    </div>
  );
}
