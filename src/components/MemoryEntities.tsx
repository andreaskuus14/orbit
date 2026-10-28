"use client";
// Entity graph in the MEMORY panel (entity-graph.ts): "Are these the same?" merge suggestions and "Which is right?" questions when
// two memories disagree. His answer is only recorded (POST /api/memories/entities); no memory or person is edited or deleted.
import { useCallback, useEffect, useState } from "react";
import { useT } from "./i18n";
import type { Contradiction, MergeSuggestion } from "@/lib/entity-graph-pure";

export function MemoryEntities() {
  const { t } = useT();
  const [v, setV] = useState<{ merges: MergeSuggestion[]; contradictions: Contradiction[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => fetch("/api/memories/entities").then((r) => r.ok ? r.json() : null).then((j) => j && setV(j), () => {}), []);
  useEffect(() => { void load(); }, [load]);

  async function answer(key: string, choice: string) {
    setBusy(key); setErr("");
    try {
      const r = await fetch("/api/memories/entities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, choice }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || t("common.failed"));
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : t("common.failed")); }
    finally { setBusy(null); }
  }

  if (!v || (!v.merges.length && !v.contradictions.length && !err)) return null;
  return (
    <div className="card space-y-2" aria-label={t("ent.title")}>
      <div className="muted text-[10px] uppercase tracking-widest">{t("ent.title")}</div>
      {err && <p className="error" role="alert">{err}</p>}
      <ul className="space-y-2">
        {v.contradictions.map((c) => (
          <li key={c.key} className="space-y-1">
            <b>{t("ent.which", { who: c.entity === "me" ? t("ent.me") : c.entity, attr: t(`ent.attr.${c.attr}` as const) })}</b>
            <ul className="space-y-1 text-xs">{c.options.map((o) => (
              <li key={o.norm} className="flex items-center gap-2">
                <button className="chip" onClick={() => answer(c.key, o.norm)} disabled={busy !== null} aria-label={`${t("ent.pick")}: ${o.value}`}>{t("ent.pick")}</button>
                <span className="truncate"><b>{o.value}</b> <span className="muted">· {o.src.title} · {o.src.at.slice(0, 10)}</span></span>
              </li>))}</ul>
            <button className="chip" onClick={() => answer(c.key, "skip")} disabled={busy !== null}>{t("ent.skip")}</button>
          </li>))}
        {v.merges.map((m) => (
          <li key={m.key} className="space-y-1">
            <b>{t("ent.same")}</b> <span className="muted num text-xs">{Math.round(m.confidence * 100)}%</span>
            <p className="text-xs truncate">{m.forms.join(" · ")}</p>
            <div className="flex gap-2">
              <button className="btn" onClick={() => answer(m.key, "same")} disabled={busy !== null}>{busy === m.key ? "…" : t("ent.yes")}</button>
              <button className="chip" onClick={() => answer(m.key, "different")} disabled={busy !== null}>{t("ent.no")}</button>
            </div>
          </li>))}
      </ul>
    </div>
  );
}
