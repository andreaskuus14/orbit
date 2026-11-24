"use client";
// "What ORBIT knows about you" (MEMORY → What ORBIT knows about you; also what CORE's "what do you know about me" opens).
// One plain list, grouped (about you, how you like things, people, projects, lessons and mistakes, skills, journal), each item with
// Edit, Delete and where it came from. Journal entries show only "Journal entry · date". Nothing here goes to a model:
// GET /api/knows only reads, and each edit goes to that store's own route (knowRequest in knows-pure.ts).
import { useCallback, useEffect, useState } from "react";
import { itemLine, knowRequest, type EditCtx, type Group, type KnowItem } from "@/lib/knows-pure";
import type { Key } from "@/lib/i18n-pure";
import { useT } from "./i18n";
import { askConfirm } from "./ui/Dialog";

type View = { groups: { group: Group; items: KnowItem[] }[]; ctx: EditCtx; missing: string[] };
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString([], { dateStyle: "medium" }) : "");

export function KnowsPanel({ onBack, onBeliefs }: { onBack: () => void; onBeliefs?: () => void }) {
  const { t } = useT();
  const [view, setView] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState<{ key: string; text: string } | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/knows").then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setView(r as View); setErr("");
    } catch (e) { setErr(t("knows.failed", { e: e instanceof Error ? e.message : "?" })); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const run = async (i: KnowItem, value: string | null) => {
    if (!view || busy) return;
    if (value === null && !(await askConfirm(t("knows.confirmDelete")))) return;
    const req = knowRequest(i, value, view.ctx);
    if (typeof req === "string") { setErr(req); return; }
    setBusy(i.key); setErr("");
    try {
      const r = await fetch(req.url, { method: req.method, headers: { "Content-Type": "application/json" }, ...(req.body && { body: JSON.stringify(req.body) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setEdit(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    setBusy("");
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="link" onClick={onBack}>← {t("knows.close")}</button>
        <h3 className="h3 min-w-0 flex-1">{t("knows.title")}</h3>
        {onBeliefs && <button type="button" className="link text-xs" onClick={onBeliefs}>{t("mem.beliefs")}</button>}
      </div>
      <p className="muted text-sm">{t("knows.intro")}</p>
      {err && <p className="error text-sm" role="alert">{err}</p>}
      {!view && !err && <p className="muted text-sm">{t("knows.loading")}</p>}
      {view && !view.groups.length && <p className="muted text-sm">{t("knows.empty")}</p>}
      {view?.groups.map((g) => (
        <section key={g.group} aria-label={t(`knows.g.${g.group}` as Key)} className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide opacity-70">{t(`knows.g.${g.group}` as Key)} · {g.items.length}</h4>
          {g.group === "journal" && <p className="muted text-xs">{t("knows.journalNote")}</p>}
          <ul className="space-y-1">
            {g.items.map((i) => (
              <li key={i.key} className="knows-row">
                {edit?.key === i.key ? (
                  <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); void run(i, edit.text); }}>
                    {i.label && <div className="text-xs font-medium">{i.label}</div>}
                    <textarea className="field w-full text-sm" rows={Math.min(8, Math.max(2, Math.ceil(edit.text.length / 70)))} value={edit.text} autoFocus
                      onChange={(e) => setEdit({ key: i.key, text: e.target.value })} aria-label={t("knows.edit")} />
                    <div className="flex gap-2">
                      <button className="btn" disabled={busy === i.key}>{busy === i.key ? t("knows.saving") : t("knows.save")}</button>
                      <button type="button" className="chip" onClick={() => setEdit(null)}>{t("knows.cancel")}</button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">{i.label && <b className="mr-1.5">{i.label}:</b>}<span className="knows-text">{itemLine(i, t("knows.journalEntry"))}</span></div>
                      <div className="muted text-[11px]">{t("knows.from")}: {t(`knows.src.${i.src}` as Key)}{i.at && i.store !== "journal" ? ` · ${day(i.at)}` : ""}</div>
                    </div>
                    {i.edit && <button type="button" className="chip" disabled={!!busy} onClick={() => setEdit({ key: i.key, text: i.text })}>{t("knows.edit")}</button>}
                    {i.del && <button type="button" className="chip" disabled={!!busy} onClick={() => void run(i, null)}>{busy === i.key ? "…" : t("knows.delete")}</button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!!view?.missing.length && <p className="muted text-xs">{t("knows.missing", { e: view.missing.join(" · ") })}</p>}
    </div>
  );
}
