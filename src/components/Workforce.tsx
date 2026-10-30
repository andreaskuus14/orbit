"use client";
// AGENTS workforce views (AGT01 capability cards, AGT05 night shift plan + planned-vs-produced). Rules: lib/roster-pure.ts.
// AGENTS configures the workforce; running, approving and editing tasks happens in OPERATIONS (deep links, deeplink-pure.ts).
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./AgentMission";
import { useT } from "./i18n";
import { capRow, type DepState } from "@/lib/capability-pure";
import { linkToHash } from "@/lib/deeplink-pure";
import { nightBudget, nightCompare, workerCard, type Outcome, type Planned } from "@/lib/roster-pure";
import type { NightRun, NightSettings } from "@/lib/night-pure";
import type { NightPick } from "@/lib/night-plan-pure";

export type RosterAgent = { slug: string; name: string; role: string; color: string; tools?: string[]; stats: { running: number; done?: number; failed?: number } };
export type Deps = { configured: DepState | null; available: DepState | null } | null;
export type ToolInfo = { name: string; approval: boolean };

export const OPS_HREF = linkToHash({ planet: "operations" });
const yn = (v: boolean | null | undefined, unknown: string) => (v === true ? "✓" : v === false ? "✗" : unknown);

export function WorkerCards({ agents, deps, tools, onPick }: { agents: RosterAgent[]; deps: Deps; tools: ToolInfo[]; onPick: (slug: string) => void }) {
  const { t, lang } = useT();
  const approval = useMemo(() => new Set(tools.filter((x) => x.approval).map((x) => x.name)), [tools]);
  const unknown = {} as DepState; // no answer from the server: every connection unknown, nothing marked limited
  return (
    <ul className="grid gap-2">
      {agents.map((a) => {
        const c = workerCard({ ...a, tools: a.tools ?? [] }, approval, deps?.configured ?? unknown, deps?.available ?? unknown);
        const asks = c.tools.filter((x) => x.approval).map((x) => x.name.replace(/_/g, " "));
        return (
          <li key={a.slug} className="card space-y-1 text-xs">
            <div className="flex items-start justify-between gap-2">
              <button className="link text-sm font-medium" style={{ color: a.color }} onClick={() => onPick(a.slug)}>{a.name}</button>
              <span className={`pill ${c.limited.length ? "bad" : "ok"}`}>{c.limited.length ? t("agt.limited") : t("agt.ready")}</span>
            </div>
            <p className="muted">{t("agt.domain")}: {c.domain || "—"}</p>
            <p>{t("agt.tools")}: {c.tools.length ? c.tools.map((x) => `${x.name.replace(/_/g, " ")}${x.approval ? " 🔒" : ""}`).join(", ") : t("agt.noTools")}</p>
            <p>{t("agt.conns")}: {c.conns.map((x) => `${x.dep} (${t("agt.configured")} ${yn(x.configured, t("agt.unchecked"))} · ${t("agt.available")} ${yn(x.available, t("agt.unchecked"))})`).join(", ")}</p>
            <p className="muted">{t("agt.restrict")}{asks.length ? ` ${t("agt.asks", { tools: asks.join(", ") })}` : ""}</p>
            <p className="muted">{t("agt.results", { done: c.done, failed: c.failed })}</p>
            {!!c.limited.length && <p className="error" role="note">{t("agt.remedy")}: {capRow({ id: "think", deps: c.limited }, lang).why}. {capRow({ id: "think", deps: c.limited }, lang).fix}</p>}
          </li>
        );
      })}
    </ul>
  );
}

type NightView = { settings: NightSettings; running: boolean; last: (NightRun & { planned?: Planned[] }) | null; plan: { queue: NightPick[]; deferred: number } | null };
const OUT_ICON: Record<Outcome, string> = { done: "✓", approval: "⏳", failed: "✗", skipped: "–", not_run: "○" };

export function NightPlan() {
  const { t } = useT();
  const [v, setV] = useState<NightView | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => api<NightView>("/api/night").then(setV, (e) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  if (err) return <p className="error text-xs" role="alert">{err}</p>;
  if (!v) return <p className="muted text-xs">{t("common.loading")}</p>;
  const s = v.settings, q = v.plan?.queue ?? [], b = nightBudget(q, s), cmp = v.last ? nightCompare(v.last) : null;
  return (
    <section className="grid gap-2 text-xs" aria-label={t("agt.night")}>
      <div className="card space-y-1">
        <div className="hud-title text-[0.7rem]">{t("agt.tonight")}</div>
        <p>{s.enabled ? t("agt.quiet", { from: s.from, until: s.until, tz: s.tz }) : t("night.off")}</p>
        <p>{t("agt.budget", { calls: b.calls, maxCalls: b.maxCalls, min: b.minutes, maxMin: b.maxMinutes })}{v.plan?.deferred ? ` · ${t("agt.deferred", { n: v.plan.deferred })}` : ""}</p>
        <p className="muted">{t("agt.stops")}</p>
        {!v.plan ? <p className="muted">{t("agt.noPlan")}</p> : !q.length ? <p className="muted">{t("agt.nothing")}</p> : (
          <ul className="space-y-0.5">{q.map((j) => <li key={`${j.kind}:${j.ref}`}>🌙 {j.label} <span className="muted">→ {t(`agt.deliv.${j.kind}`)}</span></li>)}</ul>
        )}
      </div>
      {cmp && v.last && (
        <div className="card space-y-1">
          <div className="hud-title text-[0.7rem]">{t("agt.morning", { day: v.last.key })}</div>
          <p className={cmp.success ? "" : "error"}>{t(cmp.success ? "agt.ok" : "agt.notOk", { produced: cmp.produced, planned: cmp.planned, skipped: cmp.skipped, failed: cmp.failed, notRun: cmp.notRun })}
            {cmp.stopped ? ` · ${t("agt.stopped", { why: cmp.stopped })}` : ""}</p>
          {!v.last.planned && <p className="muted">{t("agt.oldRun")}</p>}
          <ul className="space-y-0.5">{cmp.rows.map((r, i) => (
            <li key={i}><span aria-label={t(`agt.out.${r.outcome}`)}>{OUT_ICON[r.outcome]}</span> {r.label} <span className="muted">· {t(`agt.out.${r.outcome}`)}{r.planned ? "" : ` · ${t("agt.unplanned")}`}{r.why ? ` · ${r.why}` : ""}</span></li>
          ))}</ul>
        </div>
      )}
    </section>
  );
}
