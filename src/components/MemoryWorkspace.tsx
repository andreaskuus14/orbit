"use client";
// MEMORY workspace views (MEM01/MEM02): Search with filters and "why it matched", Projects, People, and the inspector card on an
// open memory. Pure rules: lib/memory-workspace-pure.ts. Everything runs on rows already loaded for the owner; no model calls.
import dynamic from "next/dynamic";
import { useMemo, useState, type ReactNode } from "react";
import { useT } from "./i18n";
import { applyFilters, inspect, NO_FILTERS, projects, whyMatched, type Filters, type Mem } from "@/lib/memory-workspace-pure";
import type { MemoryType } from "@/lib/memory-types-pure";
import type { Key } from "@/lib/i18n-pure";

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
      {searched && mode && <p className="muted text-xs">{t(mode === "hybrid" ? "mem.hybrid" : "mem.keyword")}</p>}
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
      <ul className="space-y-2">{(g.items as T[]).map((m) => <li key={m.id}>{row(m)}</li>)}</ul></details>
  ))}</div>;
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
