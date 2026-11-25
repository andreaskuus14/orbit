"use client";
import { plainError } from "@/lib/api-error-pure";
import { useCallback, useState } from "react";
import { pollMs } from "@/lib/poll-pure";
import { usePoll } from "./use-poll";
import { MODES, grantLive, type AuthorityState, type Grant, type Mode } from "@/lib/authority-pure";
import { useT } from "./i18n";
import { changeStopAll } from "./nav-command";
import { askConfirm } from "./ui/Dialog";

type View = AuthorityState & { policyVersion: string; stopAll: boolean };

type T = ReturnType<typeof useT>["t"];
const limitText = (t: T, g: Grant) => [
  g.limits.count !== undefined && t("auth.limCount", { u: g.used.count ?? 0, n: g.limits.count }),
  g.limits.money !== undefined && t("auth.limMoney", { u: g.used.money ?? 0, n: g.limits.money }),
  g.limits.calls !== undefined && t("auth.limCalls", { u: g.used.calls ?? 0, n: g.limits.calls }),
].filter(Boolean).join(" · ") || t("auth.noLimits");

const state = (t: T, g: Grant) => g.revoked ? t("auth.revoked") : g.paused ? t("auth.paused") : grantLive(g, Date.now()) ? t("auth.active") : t("auth.inactive");
const MODE_KEY = { observe: "auth.mObserve", prepare: "auth.mPrepare", operate: "auth.mOperate", hold: "auth.mHold" } as const satisfies Record<Mode, string>;

/** Profile → Authority: standing grants with their limits, pause/revoke, workflow modes and Stop-all. Changes apply at the next action. */
export function AuthoritySection() {
  const { t } = useT();
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ workflow: "", actions: "", count: "" });
  const call = useCallback(async (body?: object) => {
    setErr("");
    const r = await fetch("/api/authority", body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined).catch(() => null);
    const j = r && (await r.json().catch(() => null));
    if (r?.ok && j) setV(j); else setErr(t("auth.loadErr"));
  }, [t]);
  const poll = useCallback(() => void call(), [call]);
  usePoll(poll, pollMs(30_000));

  async function stopAll() {
    if (!(await askConfirm(t("auth.stopConfirm")))) return;
    try { await changeStopAll(true); await call(); } catch (e) { setErr(plainError(e, t("auth.stopErr"))); }
  }
  function addGrant() {
    void call({ action: "grant", workflow: form.workflow, actions: form.actions.split(",").map((a) => a.trim()).filter(Boolean), limits: form.count ? { count: Number(form.count) } : {} });
  }

  return (
    <section className="space-y-3" aria-labelledby="authority-title">
      <h3 id="authority-title" className="text-sm font-semibold">{t("auth.title")}</h3>
      <p className="muted text-sm">{t("auth.help")}</p>
      <button className="btn w-full py-3 text-base" onClick={() => void stopAll()} disabled={v?.stopAll}>{v?.stopAll ? t("auth.stopOn") : t("auth.stopAll")}</button>
      {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
      <ul className="space-y-2" aria-label={t("auth.grants")}>
        {v?.grants.length === 0 && <li className="muted text-sm">{t("auth.noGrants")}</li>}
        {v?.grants.map((g) => (
          <li key={g.id} className="rounded border border-white/10 p-2 text-sm">
            <div><b>{g.workflow}</b> · {state(t, g)}</div>
            <div className="muted text-xs">{g.actions.join(", ")} · {limitText(t, g)}{g.destinations.length ? ` · ${t("auth.to", { list: g.destinations.join(", ") })}` : ""}{g.expiresAt ? ` · ${t("auth.until", { d: g.expiresAt.slice(0, 10) })}` : ""}</div>
            {!g.revoked && <div className="mt-1 flex gap-2">
              <button className="chip" onClick={() => void call({ action: "pause", id: g.id, on: !g.paused })}>{g.paused ? t("auth.resume") : t("auth.pause")}</button>
              <button className="chip" onClick={async () => (await askConfirm(t("auth.revokeConfirm", { w: g.workflow }))) && void call({ action: "revoke", id: g.id })}>{t("auth.revoke")}</button>
            </div>}
          </li>
        ))}
      </ul>
      <div className="space-y-1" aria-label={t("auth.modes")}>
        {Object.entries(v?.modes ?? {}).map(([w, m]) => (
          <label key={w} className="flex items-center justify-between gap-2 text-sm">{w}
            <select className="field min-w-0 max-w-[65%] truncate" value={m} onChange={(e) => void call({ action: "mode", workflow: w, mode: e.target.value === "" ? null : e.target.value })}>
              {MODES.filter((x) => x !== "operate").map((x: Mode) => <option key={x} value={x}>{t(MODE_KEY[x])}</option>)}
              <option value="">{t("auth.noMode")}</option>
            </select>
          </label>
        ))}
      </div>
      <details className="text-sm">
        <summary>{t("auth.addHead")}</summary>
        <div className="mt-2 space-y-2">
          <label className="block">{t("auth.workflow")}<input className="field w-full" placeholder={t("auth.workflowPh")} value={form.workflow} onChange={(e) => setForm({ ...form, workflow: e.target.value })} /></label>
          <label className="block">{t("auth.actions")}<input className="field w-full" placeholder={t("auth.actionsPh")} value={form.actions} onChange={(e) => setForm({ ...form, actions: e.target.value })} /></label>
          <label className="block">{t("auth.max")}<input className="field w-full" type="number" min={0} placeholder={t("auth.maxPh")} value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} /></label>
          <div className="flex gap-2">
            <button className="chip" onClick={addGrant}>{t("auth.add")}</button>
            <button className="chip" onClick={() => void call({ action: "mode", workflow: form.workflow, mode: "prepare" })}>{t("auth.setPrepare")}</button>
            <button className="chip" onClick={() => void call({ action: "mode", workflow: form.workflow, mode: "hold" })}>{t("auth.hold")}</button>
          </div>
        </div>
      </details>
      <p className="muted text-xs">{t("auth.policy", { v: v?.policyVersion ?? "" })}</p>
    </section>
  );
}
