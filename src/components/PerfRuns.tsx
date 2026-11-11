"use client";
import { useEffect, useState } from "react";
import { useT } from "./i18n";
import type { CompareRow } from "@/lib/perf-run-pure";

type Run = { at: number; label: string; gpu: string; hidden: boolean; rows: CompareRow[] };

/** ANALYTICS: the recent scripted perf runs (npm run perf:run), each vs a comparable previous run. */
export function PerfRuns() {
  const { t } = useT();
  const [runs, setRuns] = useState<Run[] | null>(null);
  useEffect(() => { void fetch("/api/perf/run").then((r) => (r.ok ? r.json() : null)).then((j) => setRuns(j?.runs ?? []), () => setRuns([])); }, []);
  if (!runs) return null;
  const latest = runs[0];
  return (
    <section className="space-y-2" aria-label="Perf runs">
      <h3 className="h3">PERF</h3>
      <div className="card space-y-1.5">
        {!latest ? <p className="muted text-sm">No perf runs yet. On the PC: <code>npm run perf:run</code>, or Shift+Alt+P here.</p> : <>
          <table className="w-full text-xs" aria-label={`Latest perf run, ${latest.label}`}>
            <caption className="text-left text-sm">{latest.label} · {new Date(latest.at).toLocaleString()}{latest.hidden ? " · window was hidden (not valid)" : ""}<div className="muted text-xs">{latest.gpu}</div></caption>
            <thead><tr><th className="text-left">Segment</th><th className="text-right">fps</th><th className="text-right">p95 ms</th><th className="text-right">Long</th><th className="text-right">vs prev</th></tr></thead>
            <tbody>{latest.rows.map((r) => (
              <tr key={r.seg} style={r.regressed ? { color: "var(--rose)" } : undefined}>
                <td>{r.seg}</td><td className="text-right num">{r.fps}</td><td className="text-right num">{r.p95}</td><td className="text-right num">{r.long}</td>
                <td className="text-right num">{r.renderChanged ? t("perf.renderChanged") : r.pct === null ? "–" : `${r.pct > 0 ? "+" : ""}${r.pct}%`}{r.regressed ? " ⚠" : ""}</td>
              </tr>))}</tbody>
          </table>
          {!latest.hidden && latest.rows.every((r) => r.prevP95 === null && !r.renderChanged) && <p className="muted text-xs">{t("perf.noBaseline")}</p>}
          <ul className="space-y-0.5 text-xs">{runs.slice(1).map((r) => {
            const bad = r.rows.filter((x) => x.regressed).map((x) => x.seg), idle = r.rows.find((x) => x.seg === "galaxy-idle");
            return <li key={r.at}><span className="muted">{new Date(r.at).toLocaleDateString()}</span> {r.label} · galaxy {idle ? `${idle.fps} fps, p95 ${idle.p95} ms` : "–"}{bad.length ? <b style={{ color: "var(--rose)" }}> · slower: {bad.join(", ")}</b> : null}</li>;
          })}</ul>
        </>}
      </div>
    </section>
  );
}
