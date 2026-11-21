"use client";
// GAME DEV → Test → AI testers. Its work shows through the shared "Working on it" card; below it only what he acts on or reads:
// the on/off switch, the heatmap, the bug list with repro steps and the fixes that wait for his Approve. Rules: lib/playtesters-pure.ts.
import { useCallback, useEffect, useState } from "react";
import { squadProgress, type Bug, type Live, type Report } from "@/lib/playtesters-pure";
import { ProgressCard } from "./ProgressCard";
import { useT } from "./i18n";

type Fix = Omit<Report["proposals"][number], "before" | "after"> & { diff: string[] };
type View = { allowed: boolean; live: Live; hasHeatmap: boolean; squad: { id: string; name: string; type: string }[]; report: (Omit<Report, "proposals" | "heatSvg"> & { proposals: Fix[] }) | null; note?: string };

async function api(body?: unknown): Promise<View> {
  const res = await fetch("/api/playtesters", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Failed (${res.status})`);
  return j as View;
}

function Spark({ points }: { points: { step: number; value: number }[] }) {
  if (points.length < 2) return null;
  const xs = points.map((p) => p.step), ys = points.map((p) => p.value), x0 = Math.min(...xs), x1 = Math.max(...xs) || 1, y0 = Math.min(...ys), y1 = Math.max(...ys);
  const d = points.map((p) => `${((p.step - x0) / (x1 - x0 || 1)) * 96 + 2},${22 - ((p.value - y0) / (y1 - y0 || 1)) * 20}`).join(" ");
  return <svg width="100" height="24" aria-hidden="true"><polyline points={d} fill="none" stroke="var(--cyan)" strokeWidth="1.5" /></svg>;
}

export default function AiPlaytesters() {
  const { t, lang } = useT();
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => api().then(setV, (e) => setErr(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!v?.live.running) return; const id = setInterval(load, 5000); return () => clearInterval(id); }, [v?.live.running, load]);
  const act = async (what: string, body: unknown) => {
    setBusy(what); setErr("");
    try { setV(await api(body)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); }
  };
  if (!v) return <p className="muted text-sm" role="status">{err || t("common.loading")}</p>;
  const r = v.report, card = squadProgress(v.live, (r as unknown as Report) ?? null, lang, Date.now());
  const fixes = r?.proposals.filter((p) => p.status === "pending") ?? [];
  const who = (id: string) => v.squad.find((x) => x.id === id)?.name ?? id;
  const names = (b: Bug) => b.who.map(who).join(", ");

  return (
    <section className="space-y-3">
      <header className="space-y-1">
        <h3 className="font-medium">{t("pt.title")}</h3>
        <p className="muted text-sm">{t("pt.purpose")}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.allowed} disabled={!!busy} onChange={(e) => act("allow", { action: "allow", on: e.target.checked })} />
          {t("pt.allow")}
        </label>
        {!v.allowed && <p className="muted text-xs">{t("pt.off")}</p>}
        {v.allowed && !v.live.running && <button type="button" className="btn px-3 py-1 text-xs" disabled={!!busy} onClick={() => act("run", { action: "run" })}>{t("pt.run")}</button>}
      </header>
      {err && <p className="error text-sm" role="alert">{err}</p>}
      {v.note && <p className="text-sm" role="status">{v.note}</p>}
      {card && <ProgressCard p={card} onAction={() => document.getElementById("pt-fixes")?.scrollIntoView({ behavior: "smooth" })} />}

      {r && (<>
        {fixes.length > 0 && (
          <div id="pt-fixes" className="card space-y-2">
            <h4 className="font-medium">{t("pt.fixes")}</h4>
            {fixes.map((p) => (
              <div key={p.id} className="space-y-1">
                <b className="text-sm">{p.title}</b>
                <p className="muted text-xs">{p.file} · {p.why}</p>
                <pre className="overflow-x-auto text-xs">{p.diff.join("\n")}</pre>
                <div className="flex gap-2">
                  <button type="button" className="btn px-3 py-1 text-xs" disabled={!!busy} onClick={() => act(p.id, { action: "approve", id: p.id })}>{t("pt.approve")}</button>
                  <button type="button" className="chip" disabled={!!busy} onClick={() => act(p.id, { action: "dismiss", id: p.id })}>{t("pt.dismiss")}</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {v.hasHeatmap && (
          <figure className="card space-y-1">
            <figcaption className="text-sm font-medium">{t("pt.heat")}</figcaption>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/playtesters?img=heat&at=${encodeURIComponent(r.at)}`} alt={t("pt.heat")} className="max-w-full rounded" />
          </figure>
        )}

        <div className="card space-y-1">
          <h4 className="font-medium">{t("pt.bugs")}</h4>
          {!r.bugs.length && <p className="muted text-sm">{t("pt.none")}</p>}
          <ul className="space-y-1">
            {r.bugs.map((b) => (
              <li key={b.id} className="text-sm">
                <button type="button" className="w-full text-left hover:underline" onClick={() => setOpen(open === b.id ? null : b.id)}>
                  <b>{b.severity.toUpperCase()}</b> {b.title} <small className="muted">· {t(b.source === "seen" ? "pt.seen" : "pt.code")}</small>
                </button>
                {open === b.id && (
                  <div className="muted space-y-1 pl-3 text-xs">
                    {b.who.length > 0 && <p>{t("pt.who", { who: names(b) })}</p>}
                    <p>{b.evidence}</p>
                    <p>{t("pt.repro")}:</p>
                    <ol className="list-decimal pl-5">{b.repro.map((s, i) => <li key={i}>{s}</li>)}</ol>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        {(r.flow.length > 0 || r.economy.length > 0) && (
          <div className="card space-y-1 text-sm">
            <h4 className="font-medium">{t("pt.money")}</h4>
            {r.flow.map((f) => <p key={f.currency}>{t("pt.moneyRow", { c: f.currency, in: f.earned, out: f.spent, per: f.perStep })}</p>)}
            {r.economy.map((e) => <p key={e.currency} className="muted text-xs">{t("pt.earnSpend", { c: e.currency, e: e.earn.length, s: e.spend.length })}</p>)}
            {r.curves.length > 0 && <p className="muted text-xs">{t("pt.curve")}</p>}
            {r.curves.map((c) => <div key={c.tester} className="flex items-center gap-2 text-xs"><span className="w-12">{who(c.tester)}</span><Spark points={c.points} /></div>)}
          </div>
        )}

        <details className="text-xs">
          <summary className="muted">{t("pt.untested")}</summary>
          <ul className="muted list-disc pl-5">{r.untested.map((u, i) => <li key={i}>{u}</li>)}</ul>
        </details>
      </>)}
    </section>
  );
}
