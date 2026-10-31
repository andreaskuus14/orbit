"use client";
// Failure report: builds a diagnostic package from a failed turn/task/mission trace for review. Copy or download only, never sent.
import { useState } from "react";
import { buildFailureReport, refusedOnly, reportFileName, reportJson, type ReportInput, type ReportStep } from "@/lib/failure-report-pure";
import { useT } from "./i18n";

export function FailureReport({ input }: { input: Omit<ReportInput, "at" | "appVersion"> }) {
  const { t, tn } = useT();
  const [open, setOpen] = useState(false);
  const [personal, setPersonal] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [at] = useState(() => new Date().toISOString());

  function show() {
    setOpen((o) => !o);
    // Local liveness route: reads this server's build id, nothing leaves the machine.
    if (!version) fetch("/api/health").then((r) => r.json()).then((j: { buildId?: string | null }) => setVersion(j.buildId ?? null)).catch(() => {});
  }
  const refused = refusedOnly({ error: !!input.error, trace: Array.isArray(input.trace) ? input.trace as ReportStep[] : [] }); // a refusal is not a broken turn
  if (!open) return <button className="chip" onClick={show}>{refused ? tn("failrep.refused", refused) : t("failrep.button")}</button>;

  const report = buildFailureReport({ ...input, appVersion: version, at }, personal);
  const json = reportJson(report);
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = reportFileName(report);
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <section className="card space-y-2 text-xs" aria-label={t("failrep.title")}>
      <div className="flex items-center justify-between gap-2">
        <b>{t("failrep.title")}</b>
        <button className="link" onClick={() => setOpen(false)}>{t("common.close")}</button>
      </div>
      <p className="muted">{t("failrep.hint")}</p>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} />
        {t("failrep.personal")}
      </label>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[0.65rem]" aria-label={t("failrep.preview")}>{json}</pre>
      <div className="flex gap-2">
        <button className="chip" onClick={() => void navigator.clipboard?.writeText(json).then(() => setCopied(true), () => {})}>{copied ? t("failrep.copied") : t("common.copy")}</button>
        <button className="chip" onClick={download}>{t("failrep.download")}</button>
      </div>
    </section>
  );
}
