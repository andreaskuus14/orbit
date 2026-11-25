"use client";
import { useCallback, useEffect, useState } from "react";
import { useT } from "./i18n";
import type { Open } from "@/lib/clips/pipeline-pure";
import type { Batch } from "@/lib/clips/shorts-plan-pure";

// Shorts autopilot v2 on the Pipeline board: the week's picks (scripted + priced overnight) and the ONE batch Approve click.
// API: /api/studio/shorts-plan. Nothing is generated or spent before that click; the server re-checks the batch, quote and weekly cap.

type Pick = { key: string; source: string; title: string; story: string | null; status: string; step: string };
type View = { target: number; booked: number; ready: number; need: number; picks: Pick[]; batch: Batch; week: { used: number; cap: number };
  running: { ids: string[]; done: string[]; errors: string[] } | null; planning: boolean };
const SRC = { radar: "spc.src.radar", comments: "spc.src.comments", roblox: "spc.src.roblox", trend: "spc.src.trend" } as const;

async function call<T>(body?: unknown): Promise<T> {
  const res = await fetch("/api/studio/shorts-plan", body ? { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

export default function ShortsPlanCard({ active, target, onOpen }: { active: boolean; target: number; onOpen: (o: Open) => void }) {
  const { t } = useT();
  const [v, setV] = useState<View | null>(null);
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const load = useCallback(() => call<View>().then(setV, (e) => setErr(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { if (active) void load(); }, [active, load]);
  useEffect(() => { if (v && v.target !== target) void call<View>({ action: "target", target }).then(setV, () => {}); }, [v, target]);
  useEffect(() => { if (!active || !(v?.running || v?.planning)) return; const iv = setInterval(load, 10_000); return () => clearInterval(iv); }, [active, v?.running, v?.planning, load]);

  async function act(name: string, body: unknown) {
    setBusy(name); setErr("");
    try { await call(body); await load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); }
  }
  if (!v) return err ? <p className="error text-[11px]" role="alert">{err}</p> : null;
  const b = v.batch;

  return (
    <section className="card" aria-label={t("spc.label")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="hud-title studio-title !text-[0.7rem]">{t("spc.title")}</h3>
        <button className="chip !text-[11px]" disabled={!!busy || v.planning} onClick={() => void act("prep", { action: "prep" })}>
          {v.planning ? t("spc.planning") : t("spc.plan")}</button>
      </div>
      <p className="muted mt-1 text-[11px]">{v.need ? (v.need > 1 ? t("spc.needN", { n: v.need, t: v.target }) : t("spc.need1", { t: v.target })) : t("spc.onTrack", { t: v.target })}
        {" "}· {t("spc.night")} · {t("spc.credits", { u: v.week.used, c: v.week.cap })}</p>
      {v.picks.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {v.picks.map((p) => (
            <li key={p.key} className="flex items-center gap-2 text-[11px]">
              <span className="chip !px-1.5 !py-0 !text-[10px]">{p.source in SRC ? t(SRC[p.source as keyof typeof SRC]) : p.source}</span>
              {p.story ? <button className="min-w-0 flex-1 truncate text-left underline-offset-2 hover:underline" onClick={() => onOpen({ tool: "story", story: p.story! })}>{p.title}</button>
                : <span className="min-w-0 flex-1 truncate">{p.title}</span>}
              <span className="muted shrink-0 truncate text-[10px]" style={{ maxWidth: "45%" }}>{p.step}</span>
            </li>
          ))}
        </ul>
      )}
      {b.items.length > 0 && !v.running && (
        <div className="mt-2 rounded-lg border border-white/10 p-1.5">
          <ul className="muted text-[10px]">{b.items.map((i) => <li key={i.id}>{i.title} · {i.part} · {i.credits} cr</li>)}</ul>
          <button className="btn mt-1.5 !px-3 !py-1 !text-xs" disabled={!!busy} onClick={() => void act("approve", { action: "approve", ids: b.items.map((i) => i.id), credits: b.credits })}>
            {busy === "approve" ? t("spc.approving") : b.label}</button>
        </div>
      )}
      {b.why && <p className="muted mt-1 text-[10px]">{b.why}</p>}
      {v.running && <p className="mt-1 text-[11px]" aria-live="polite">{t("spc.making", { d: v.running.done.length, n: v.running.ids.length })}</p>}
      {v.running?.errors.map((e) => <p key={e} className="error text-[10px]">{e}</p>)}
      {err && <p className="error mt-1 text-[11px]" role="alert">{err}</p>}
    </section>
  );
}
