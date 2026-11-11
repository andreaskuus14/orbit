"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, type MissionAgent } from "./AgentMission";
import { useT } from "./i18n";

export function MissionBriefForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const { t, lang } = useT();
  const [agents, setAgents] = useState<MissionAgent[]>([]);
  const [stepCount, setStepCount] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    api<{ agents: MissionAgent[] }>("/api/agents", { signal: controller.signal })
      .then(({ agents: roster }) => setAgents(roster))
      .catch((e: Error) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !agents.length) return;
    const values = new FormData(event.currentTarget);
    const value = (name: string) => String(values.get(name) ?? "").trim();
    const steps = Array.from({ length: stepCount }, (_, i) => ({ agent: value(`agent-${i}`), request: value(`request-${i}`) }));
    setBusy(true);
    setError("");
    try {
      await api("/api/missions", {
        method: "POST",
        body: JSON.stringify({
          lang, objective: value("objective"), acceptance: value("acceptance"),
          constraints: value("constraints").split("\n").filter((line) => line.trim()),
          brief: { output: value("output"), evidence: value("evidence"), approvalPoints: value("approvalPoints") },
          steps,
        }),
      });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("mission.brief.startFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-3" aria-label={t("mission.brief.title")}>
      <fieldset disabled={busy} className="grid gap-2">
        <label>{t("mission.brief.goal")}<input className="field mt-1 w-full" name="objective" required maxLength={300} /></label>
        <label>{t("mission.brief.constraints")}<textarea className="field mt-1 w-full" name="constraints" rows={2} maxLength={300} /></label>
        <label>{t("mission.brief.output")}<input className="field mt-1 w-full" name="output" maxLength={300} /></label>
        <label>{t("mission.brief.acceptance")}<input className="field mt-1 w-full" name="acceptance" required maxLength={300} /></label>
        <label>{t("mission.brief.evidence")}<textarea className="field mt-1 w-full" name="evidence" rows={2} maxLength={300} /></label>
        <label>
          {t("mission.brief.approvals")}
          <textarea className="field mt-1 w-full" name="approvalPoints" rows={2} maxLength={300} />
        </label>
        <p className="muted">{t("mission.brief.approvalsHint")}</p>
      </fieldset>
      {Array.from({ length: stepCount }, (_, i) => (
        <fieldset key={i} disabled={busy} className="grid gap-2 rounded border border-white/10 p-2">
          <legend className="px-1">{t("mission.brief.step", { n: i + 1 })}</legend>
          <label>
            {t("mission.brief.agent")}
            <select className="field mt-1 w-full" name={`agent-${i}`} defaultValue="" required>
              <option value="" disabled>{t("mission.brief.chooseAgent")}</option>
              {agents.map(({ slug, name }) => <option key={slug} value={slug}>{name}</option>)}
            </select>
          </label>
          <label>{t("mission.brief.request")}<textarea className="field mt-1 w-full" name={`request-${i}`} required rows={2} maxLength={2000} /></label>
        </fieldset>
      ))}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {stepCount < 5 && <button type="button" className="chip" disabled={busy} onClick={() => setStepCount(stepCount + 1)}>{t("mission.brief.addStep")}</button>}
        {stepCount > 2 && <button type="button" className="chip" disabled={busy} onClick={() => setStepCount(stepCount - 1)}>{t("mission.brief.removeStep")}</button>}
        <button type="submit" className="chip" disabled={busy || !agents.length}>{t(busy ? "mission.brief.starting" : "mission.brief.start")}</button>
        <button type="button" className="chip" disabled={busy} onClick={onCancel}>{t("mission.brief.cancel")}</button>
      </div>
    </form>
  );
}
