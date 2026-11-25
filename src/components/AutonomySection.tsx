"use client";
import { plainError } from "@/lib/api-error-pure";
import { useCallback, useEffect, useState } from "react";
import { pollMs } from "@/lib/poll-pure";
import { usePoll } from "./use-poll";
import { useT } from "./i18n";
import { AREAS, AREA_INFO, AUTO_CONFIRM, LIMIT_MAX, type Area, type Level, type Levels, type Limits, type Pending } from "@/lib/autonomy-pure";
import { changeStopAll } from "./nav-command";
import { TwinCard } from "./TwinCard";
import { PcPermissionsCard } from "./PcPermissionsCard";
import { KIND_LABEL, type TwinKind } from "@/lib/twin-pure";
import type { TrustSuggestion } from "@/lib/trust-pure";
import type { Key } from "@/lib/i18n-core-pure";
import { askText } from "./ui/Dialog";

type View = { levels: Levels; limits: Limits; pending: Pending[]; today: { at: string; area: Area; action: string; ref: string }[]; stopAll: boolean; push: string | null; trust?: TrustSuggestion[]; problem?: string | null };

/** Profile → Autonomy: per-area level, limits for auto, today's auto actions (ledger), queued ones with Cancel, and Pause all (= Stop-all). */
export function AutonomySection() {
  const { t } = useT();
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const [limits, setLimitsDraft] = useState<Limits | null>(null);
  const [twin, setTwin] = useState<{ area: Area; from: Level; to: Level } | null>(null); // the twin argues against the latest raise (never blocks it)
  const [muted, setMuted] = useState<TwinKind[]>([]);
  const mute = (kind: TwinKind, on: boolean) => void fetch("/api/twin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "mute", kind, muted: on }) })
    .then((r) => r.json()).then((j) => Array.isArray(j?.muted) && setMuted(j.muted), () => {});
  const call = useCallback(async (body?: object) => {
    setErr("");
    const r = await fetch("/api/autonomy", body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined).catch(() => null);
    const j = r && (await r.json().catch(() => null));
    if (r?.ok && j) { setV(j); setLimitsDraft(j.limits); } else setErr("Couldn't load Autonomy. Your settings are safe. Try again.");
  }, []);
  useEffect(() => { void fetch("/api/twin").then((r) => r.json()).then((j) => Array.isArray(j?.muted) && setMuted(j.muted), () => {}); }, []);
  const poll = useCallback(() => void call(), [call]);
  usePoll(poll, pollMs(30_000));

  async function pick(area: Area, level: Level) {
    const argue = () => v && setTwin({ area, from: v.levels[area], to: level });
    if (level === "auto") {
      const phrase = AUTO_CONFIRM[area]!;
      const typed = (await askText(`${AREA_INFO[area].label} → Auto with limits.\n\nORBIT will then act WITHOUT your click (this changes AGENTS.md rule 6 for this area). Limits: ${area === "business-send" ? `${v?.limits.sendPerDay} emails/day, existing prospects only` : `${v?.limits.publishPerDay} Shorts/day`}, only drafts/clips made after you switch this on, nothing with numbers, prices, payments, offers, dates, contracts or promises, 10 minutes to cancel (held 23:00-08:00), a push after each one, Stop-all pauses it.\n\nType ${phrase} to confirm:`));
      if (typed === null) return;
      argue();
      return void call({ action: "level", area, level, confirm: typed });
    }
    argue();
    void call({ action: "level", area, level });
  }
  async function pauseAll() {
    setErr("");
    try { await changeStopAll(true); await call(); } catch (e) { setErr(plainError(e, "Couldn't pause")); }
  }

  return (
    <section className="space-y-3" aria-labelledby="autonomy-title">
      <h3 id="autonomy-title" className="text-sm font-semibold">{t("profile.autonomy")}</h3>
      <p className="muted text-sm">{t("aut.help")}</p>
      <button className="btn w-full py-3 text-base" onClick={() => void pauseAll()} disabled={v?.stopAll} aria-describedby="autonomy-pause">
        {v?.stopAll ? t("aut.paused") : t("aut.pause")}
      </button>
      <p id="autonomy-pause" className="muted text-xs">{t("aut.pauseHelp")}</p>
      <PcPermissionsCard />
      <dl className="muted space-y-2 text-xs">
        {(["off", "ask", "do", "auto"] as const).map((l) => <div key={l} className="block"><dt className="block font-semibold">{t(`lvl.${l}`)}</dt><dd className="m-0 block">{t(`lvl.${l}.means`)}</dd></div>)}
      </dl>
      {v?.problem && <p className="error text-sm" role="alert">{v.problem}</p>}
      {v?.push && <p className="muted text-xs">{t("aut.needPush", { why: v.push })}</p>}
      {!!v?.trust?.length && (
        <div className="space-y-2" role="region" aria-labelledby="trust-title">
          <h4 id="trust-title" className="text-xs font-semibold">{t("trust.title")}</h4>
          {v.trust.map((s) => (
            <div key={s.area} className="space-y-1 text-sm">
              <p>{t("trust.line", { approved: s.approved, total: s.total, kind: t(`trust.kind.${s.kind}` as Key) })}</p>
              <p className="muted text-xs">{t("trust.change", { area: AREA_INFO[s.area].label })}</p>
              <span className="flex gap-1">
                <button className="btn" onClick={() => pick(s.area, s.to)}>{t("trust.accept")}</button>
                <button className="chip" onClick={() => void call({ action: "snooze", area: s.area })}>{t("trust.later")}</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {v && (
        <ul className="space-y-2">
          {AREAS.map((a) => (
            <li key={a} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span><b>{AREA_INFO[a].label}</b> <span className="muted text-xs">{AREA_INFO[a].what}</span></span>
              <span className="flex gap-1" role="radiogroup" aria-label={AREA_INFO[a].label}>
                {AREA_INFO[a].levels.map((l) => (
                  <button key={l} role="radio" aria-checked={v.levels[a] === l} className={v.levels[a] === l ? "btn" : "chip"} disabled={l === "auto" && !!v.push && v.levels[a] !== "auto"} onClick={() => v.levels[a] !== l && pick(a, l)}>
                    {t(`lvl.${l}`)}{l === AREA_INFO[a].def ? t("lvl.default") : ""}
                  </button>
                ))}
              </span>
              {twin?.area === a && <div className="w-full"><TwinCard decision={{ kind: "autonomy", ref: `${a}.${twin.to}`, title: `${AREA_INFO[a].label}: ${t(`lvl.${twin.from}`)} → ${t(`lvl.${twin.to}`)}`, detail: AREA_INFO[a].what, from: twin.from, to: twin.to }} /></div>}
            </li>
          ))}
        </ul>
      )}
      {limits && (
        <form className="flex flex-wrap items-end gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); void call({ action: "limits", ...limits }); }}>
          <label>{t("aut.emails")}<input type="number" min={1} max={LIMIT_MAX.sendPerDay} className="field mt-1 block w-24" value={limits.sendPerDay} onChange={(e) => setLimitsDraft({ ...limits, sendPerDay: Number(e.target.value) })} /></label>
          <label>{t("aut.shorts")}<input type="number" min={1} max={LIMIT_MAX.publishPerDay} className="field mt-1 block w-24" value={limits.publishPerDay} onChange={(e) => setLimitsDraft({ ...limits, publishPerDay: Number(e.target.value) })} /></label>
          <button className="chip">{t("aut.saveLimits")}</button>
        </form>
      )}
      {!!v?.pending.length && (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold">{t("aut.waiting")}</h4>
          <ul className="space-y-1">
            {v.pending.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{p.label} <span className="muted text-xs">{p.dueAt ? t("aut.at", { at: new Date(p.dueAt).toLocaleTimeString() }) : t("aut.held")}</span></span>
                <button className="chip" onClick={() => void call({ action: "cancel", id: p.id })}>{t("aut.cancel")}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-1">
        <h4 className="text-xs font-semibold">{t("aut.today")}</h4>
        {v?.today.length ? (
          <ul className="space-y-1 text-sm">
            {v.today.map((x, i) => <li key={i}>{new Date(x.at).toLocaleTimeString()}: {x.action === "send" ? t("aut.sent") : t("aut.scheduled")} <span className="muted text-xs">({x.ref})</span></li>)}
          </ul>
        ) : <p className="muted text-xs">{t("aut.none")}</p>}
      </div>
      {muted.length > 0 && <p className="muted text-xs">{t("aut.twinQuiet")} {muted.map((k) => <button key={k} className="chip ml-1 text-xs" onClick={() => mute(k, false)} title={t("aut.twinTip")}>{KIND_LABEL[k]} ✕</button>)}</p>}
      {err && <p className="error text-sm" role="alert">{err}</p>}
    </section>
  );
}
