"use client";
import { useEffect, useState } from "react";
import { useT } from "./i18n";

type Entry = { day: string; text: string; model: boolean };
type View = { entries: Entry[]; total: number; page: number; pages: number };

/** AGENTS → ORBIT's log: ORBIT's own nightly diary (written by the night shift), paged and searchable. */
export function OrbitLog() {
  const { t } = useT();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    const h = setTimeout(() => {
      fetch(`/api/diary?q=${encodeURIComponent(q)}&page=${page}`).then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((j: View) => { setV(j); setErr(""); }, () => setErr(t("olog.loadFail")));
    }, 250);
    return () => clearTimeout(h);
  }, [q, page]);

  return (
    <section className="space-y-2" aria-label={t("olog.title")}>
      <h3 className="h3">{t("olog.title")}</h3>
      <input className="field w-full" type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={t("olog.search")} aria-label={t("olog.searchL")} maxLength={200} />
      {v && !v.entries.length && <p className="muted text-sm">{q ? t("olog.noMatch") : t("olog.empty")}</p>}
      <ul className="space-y-1.5">
        {v?.entries.map((e) => (
          <li key={e.day} className="card text-sm"><b className="text-xs">{e.day}</b> <span className="muted text-xs">{e.model ? "" : `· ${t("olog.plain")}`}</span><p className="mt-1">{e.text}</p></li>
        ))}
      </ul>
      {v && v.pages > 1 && (
        <div className="flex items-center gap-2 text-xs">
          <button className="chip" disabled={v.page <= 1} onClick={() => setPage(v.page - 1)}>{t("olog.newer")}</button>
          <span className="muted">{t("olog.page", { p: v.page, n: v.pages, total: v.total })}</span>
          <button className="chip" disabled={v.page >= v.pages} onClick={() => setPage(v.page + 1)}>{t("olog.older")}</button>
        </div>
      )}
      {err && <p className="error">{err}</p>}
    </section>
  );
}
