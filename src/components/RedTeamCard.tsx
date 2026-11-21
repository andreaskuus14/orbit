"use client";
import { useCallback, useEffect, useState } from "react";
import { useT } from "./i18n";
import type { Report, reportCard } from "@/lib/redteam-pure";

type View = { report: Report | null; card: ReturnType<typeof reportCard> };
const TONE = { ok: "var(--mint)", bad: "var(--rose)", none: "var(--muted, #999)" } as const;

/** OPERATIONS → Safety: last night's self-attack (redteam.ts). Each attack that got through, in plain words, and Run now. */
export function RedTeamCard() {
  const { t } = useT();
  const [v, setV] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = useCallback(() => { void fetch("/api/redteam").then((r) => (r.ok ? r.json() : null)).then((j) => j && setV(j as View)).catch(() => {}); }, []);
  useEffect(load, [load]);
  const run = async () => {
    setBusy(true); setErr("");
    const r = await fetch("/api/redteam", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "run" }) }).then((x) => x.json() as Promise<View & { error?: string }>).catch(() => ({ error: "Network error" }) as View & { error?: string });
    setBusy(false);
    if (r.error) setErr(r.error); else setV(r);
  };
  return (
    <section className="rounded-lg border border-white/10 p-3 text-sm" aria-label={t("rt.title")}>
      <div className="flex items-baseline justify-between gap-2">
        <b>{t("rt.title")}</b>
        <button className="chip" disabled={busy} onClick={() => void run()}>{busy ? "…" : t("rt.run")}</button>
      </div>
      <p className="muted text-xs">{t("rt.what")}</p>
      {v && <p className="mt-2" style={{ color: TONE[v.card.tone] }} role="status">{v.card.title}</p>}
      {v?.report && <p className="muted text-xs">{t("rt.last", { when: new Date(v.report.at).toLocaleString(), mode: v.report.mode === "live" ? t("rt.live") : t("rt.mock") })}</p>}
      {!!v?.card.lines.length && <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{v.card.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
      {!!v?.card.lines.length && <p className="muted mt-2 text-xs">{t("rt.repair")}</p>}
      {err && <p className="error text-xs" role="alert">{err}</p>}
    </section>
  );
}
