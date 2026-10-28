"use client";
import { useCallback, useEffect, useState } from "react";
import { useT } from "./i18n";
import { AREAS, AREA_INFO, AUTO_CONFIRM, LEVEL_TEXT, LIMIT_MAX, type Area, type Level, type Levels, type Limits, type Pending } from "@/lib/autonomy-pure";
import { changeStopAll } from "./nav-command";
import { TwinCard } from "./TwinCard";
import { KIND_LABEL, type TwinKind } from "@/lib/twin-pure";
import { PredictionEligible } from "./OrbitThinks";
import type { TrustSuggestion } from "@/lib/trust-pure";
import type { Key } from "@/lib/i18n-pure";

type View = { levels: Levels; limits: Limits; pending: Pending[]; today: { at: string; area: Area; action: string; ref: string }[]; stopAll: boolean; push: string | null; trust?: TrustSuggestion[] };

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
    if (r?.ok && j) { setV(j); setLimitsDraft(j.limits); } else setErr(j?.error ?? "Couldn't load Autonomy");
  }, []);
  useEffect(() => { void fetch("/api/twin").then((r) => r.json()).then((j) => Array.isArray(j?.muted) && setMuted(j.muted), () => {}); }, []);
  useEffect(() => { void call(); const h = setInterval(() => void call(), 30_000); return () => clearInterval(h); }, [call]);

  function pick(area: Area, level: Level) {
    const argue = () => v && setTwin({ area, from: v.levels[area], to: level });
    if (level === "auto") {
      const phrase = AUTO_CONFIRM[area]!;
      const typed = prompt(`${AREA_INFO[area].label} → Auto with limits.\n\nORBIT will then act WITHOUT your click (this changes AGENTS.md rule 6 for this area). Limits: ${area === "business-send" ? `${v?.limits.sendPerDay} emails/day, existing prospects only` : `${v?.limits.publishPerDay} Shorts/day`}, only drafts/clips made after you switch this on, nothing with numbers, prices, payments, offers, dates, contracts or promises, 10 minutes to cancel (held 23:00-08:00), a push after each one, Stop-all pauses it.\n\nType ${phrase} to confirm:`);
      if (typed === null) return;
      argue();
      return void call({ action: "level", area, level, confirm: typed });
    }
    argue();
    void call({ action: "level", area, level });
  }
  async function pauseAll() {
    setErr("");
    try { await changeStopAll(true); await call(); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't pause"); }
  }

  return (
    <section className="space-y-3" aria-labelledby="autonomy-title">
      <h3 id="autonomy-title" className="text-sm font-semibold">{t("profile.autonomy")}</h3>
      <p className="muted text-sm">How much ORBIT may do on its own, per area. The defaults are how ORBIT has always worked: nothing is sent, published or spent without your click.</p>
      <button className="btn w-full py-3 text-base" onClick={() => void pauseAll()} disabled={v?.stopAll} aria-describedby="autonomy-pause">
        {v?.stopAll ? "All autonomy is paused (Stop-all is on)" : "Pause all autonomy"}
      </button>
      <p id="autonomy-pause" className="muted text-xs">Turns on Stop-all: running work stops and queued auto actions are cancelled. Resume from the Stop-all button.</p>
      <dl className="muted space-y-1 text-xs">
        {(["off", "ask", "do", "auto"] as const).map((l) => <div key={l}><dt className="inline font-semibold">{LEVEL_TEXT[l].label}: </dt><dd className="inline">{LEVEL_TEXT[l].means}</dd></div>)}
      </dl>
      {v?.push && <p className="muted text-xs">Auto with limits can't be turned on yet: it needs phone pushes so you hear about every action ({v.push}). Pair your phone below and set up pushes (docs/PHONE.md).</p>}
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
                    {LEVEL_TEXT[l].label}{l === AREA_INFO[a].def ? " (default)" : ""}
                  </button>
                ))}
              </span>
              {twin?.area === a && <div className="w-full"><TwinCard decision={{ kind: "autonomy", ref: `${a}.${twin.to}`, title: `${AREA_INFO[a].label}: ${LEVEL_TEXT[twin.from].label} → ${LEVEL_TEXT[twin.to].label}`, detail: AREA_INFO[a].what, from: twin.from, to: twin.to }} /></div>}
            </li>
          ))}
        </ul>
      )}
      {limits && (
        <form className="flex flex-wrap items-end gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); void call({ action: "limits", ...limits }); }}>
          <label>Auto emails per day<input type="number" min={1} max={LIMIT_MAX.sendPerDay} className="field mt-1 block w-24" value={limits.sendPerDay} onChange={(e) => setLimitsDraft({ ...limits, sendPerDay: Number(e.target.value) })} /></label>
          <label>Auto Shorts per day<input type="number" min={1} max={LIMIT_MAX.publishPerDay} className="field mt-1 block w-24" value={limits.publishPerDay} onChange={(e) => setLimitsDraft({ ...limits, publishPerDay: Number(e.target.value) })} /></label>
          <button className="chip">Save limits</button>
        </form>
      )}
      {!!v?.pending.length && (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold">Waiting to go out (cancel within 10 min; nothing goes out 23:00-08:00)</h4>
          <ul className="space-y-1">
            {v.pending.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{p.label} <span className="muted text-xs">{p.dueAt ? `at ${new Date(p.dueAt).toLocaleTimeString()}` : "held for quiet hours: 10-min window starts at 08:00"}</span></span>
                <button className="chip" onClick={() => void call({ action: "cancel", id: p.id })}>Cancel</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-1">
        <h4 className="text-xs font-semibold">Today&apos;s auto actions</h4>
        {v?.today.length ? (
          <ul className="space-y-1 text-sm">
            {v.today.map((t, i) => <li key={i}>{new Date(t.at).toLocaleTimeString()}: {t.action === "send" ? "sent an email" : "scheduled a Short"} <span className="muted text-xs">({t.ref})</span></li>)}
          </ul>
        ) : <p className="muted text-xs">None today.</p>}
      </div>
      {muted.length > 0 && <p className="muted text-xs">The twin stays quiet on {muted.map((k) => <button key={k} className="chip ml-1 text-xs" onClick={() => mute(k, false)} title="Let the twin argue on these again">{KIND_LABEL[k]} ✕</button>)}</p>}
      <PredictionEligible />
      {err && <p className="error text-sm" role="alert">{err}</p>}
    </section>
  );
}
