"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { summarizeRuns, type ModelRuns as Runs } from "@/lib/model-log-pure";
import { useT } from "./i18n";

/** ANALYTICS: which model ran each CORE turn and agent task over the last 7 days; a risky job below Opus is flagged red (should be none). */
export function ModelRuns() {
  const { t } = useT();
  const sb = useMemo(() => createClient(), []);
  const [r, setR] = useState<Runs | null>(null);
  useEffect(() => {
    let live = true;
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    // shortcut: newest 5000 model.run rows in the window; page if a week ever holds more.
    void Promise.resolve(sb.from("events").select("id, created_at, type, planet, payload").eq("type", "model.run").gte("created_at", since).order("created_at", { ascending: false }).limit(5000))
      .then((x) => { if (live) setR(x.error ? null : summarizeRuns(x.data ?? [])); }, () => {});
    return () => { live = false; };
  }, [sb]);
  if (!r) return null;
  return (
    <section className="space-y-2" aria-label={t("mr.title")}>
      <h3 className="h3">{t("mr.title")}</h3>
      <div className="card space-y-2">
        {!r.total ? <p className="muted text-sm">{t("mr.none")}</p> : <>
          <table className="w-full text-xs" aria-label={t("mr.perModel")}>
            <thead><tr><th className="text-left">{t("mr.perModel")}</th><th className="text-right num">#</th></tr></thead>
            <tbody>{r.perModel.map((m) => <tr key={m.model}><td>{m.model}</td><td className="text-right num">{m.runs}</td></tr>)}</tbody>
          </table>
          <p className="text-xs" role="status" style={r.below ? { color: "var(--rose)", fontWeight: 600 } : undefined}>{r.below ? `⚑ ${t("mr.below", { n: r.below })}` : t("mr.ok")}</p>
          <h4 className="text-xs muted">{t("mr.risky")}</h4>
          {!r.risky.length ? <p className="muted text-xs">{t("mr.noRisky")}</p> : (
            <ul className="space-y-0.5 text-xs">{r.risky.slice(0, 100).map((x, i) => (
              <li key={`${x.at}-${i}`} style={x.below ? { color: "var(--rose)" } : undefined}>
                {x.below ? "⚑ " : ""}<span className="muted">{new Date(x.at).toLocaleString()}</span> {x.kind}/{x.job} · <b>{x.model}</b>
                {x.why.length ? <span className="muted"> · {t("mr.held")} {x.why.join(", ")}</span> : null}{x.down ? <span className="muted"> · {t("mr.down", { m: x.down })}</span> : null}
              </li>))}</ul>
          )}
        </>}
      </div>
    </section>
  );
}
