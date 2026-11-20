"use client";
// "What ORBIT does by itself" (UI audit PR 2): every STUDIO auto switch in one card (Shorts → More → Autopilot), plus the one
// status line at the top of Shorts. Each switch keeps its own meaning and storage: the same routes the old switches used
// (autopilot settings, inbox auto-clip, scout nicheAuto, devlog folder). Posting is read-only here: Profile → Autonomy owns it.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useT } from "./i18n";
import { nav } from "./palette-commands";
import { NO_AUTO, autoLine, type AutoState } from "@/lib/studio-ui-pure";
import type { Key } from "@/lib/i18n-pure";

const CLIPS = "/api/studio/clips";
async function get<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<T>;
}
async function send(url: string, method: string, body: unknown): Promise<void> {
  const r = await fetch(url, { method, cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || `Request failed (${r.status})`);
}
const val = <T,>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : null);

/** Reads every switch (each one on its own: one unreadable file leaves only its row unknown). rev bumps re-read. */
export function useAutoState(rev: number, on: boolean): AutoState {
  const [s, setS] = useState<AutoState>(NO_AUTO);
  useEffect(() => {
    if (!on) return;
    let live = true;
    void Promise.allSettled([
      get<{ settings: { auto: boolean; dailyDownloads: number } }>("/api/studio/autopilot"),
      get<{ enabled: boolean }>(`${CLIPS}/inbox-auto`),
      get<{ scout: { watchlist: { autoClip: boolean }[]; nicheAuto: boolean } }>(`${CLIPS}/scout`),
      get<{ enabled: boolean }>(`${CLIPS}/devlog`),
      get<{ levels: Record<string, AutoState["publish"]>; limits: { publishPerDay: number } }>("/api/autonomy"),
    ]).then(([ap, inbox, scout, devlog, autonomy]) => {
      if (!live) return;
      const a = val(ap), sc = val(scout)?.scout, au = val(autonomy);
      setS({
        autopilot: a?.settings.auto ?? null, perDay: a?.settings.dailyDownloads ?? null, inbox: val(inbox)?.enabled ?? null,
        niche: sc?.nicheAuto ?? null, devlog: val(devlog)?.enabled ?? null,
        creators: sc ? { auto: sc.watchlist.filter((w) => w.autoClip).length, total: sc.watchlist.length } : null,
        publish: au?.levels["studio-publish"] ?? null, publishPerDay: au?.limits.publishPerDay ?? null,
      });
    });
    return () => { live = false; };
  }, [rev, on]);
  return s;
}

/** One line at the top of Shorts: what is running by itself right now, and the way to change it. */
export function AutoLine({ s, onOpen }: { s: AutoState; onOpen: () => void }) {
  const { t } = useT();
  const parts = autoLine(s);
  if (!parts.length) return null;
  return (
    <p className="muted flex flex-wrap items-center gap-x-1.5 text-[11px]" aria-label={t("sa.title")}>
      <span aria-hidden>🤖</span>{parts.map((p) => t(p.key as Key, p.vars)).join(" · ")}
      <button type="button" className="chip !px-2 !py-0 !text-[10px]" onClick={onOpen}>{t("sa.change")}</button>
    </p>
  );
}

function Row({ label, what, on, busy, onToggle, extra }: { label: string; what: string; on: boolean | null; busy: boolean; onToggle: (on: boolean) => void; extra?: ReactNode }) {
  const { t } = useT();
  return (
    <li className="flex items-start gap-2">
      <input type="checkbox" className="mt-1" checked={!!on} disabled={on === null || busy} aria-label={label} onChange={(e) => onToggle(e.target.checked)} />
      <span className="min-w-0 flex-1"><b>{label}</b> <span className="muted">· {t(on ? "common.on" : "common.off")}</span>
        <span className="muted block">{on === null ? t("sa.unknown") : what}</span>{extra}</span>
    </li>
  );
}

/** The card. inbox: ClipFactory's own toggle (turning it on saves the current clip settings, as before). */
export function AutoCard({ s: read, inbox, onChanged, onOpenFind }: {
  s: AutoState; onChanged: () => void; onOpenFind: () => void;
  inbox: { on: boolean | null; busy: boolean; toggle: (on: boolean) => void; layout?: ReactNode; note?: ReactNode };
}) {
  const { t } = useT();
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const [saved, setSaved] = useState<Partial<AutoState>>({}); // what a switch just saved, shown until the re-read arrives
  useEffect(() => { setSaved({}); }, [read]);
  const s: AutoState = { ...read, ...saved, inbox: inbox.on ?? read.inbox };
  const run = useCallback(async (k: keyof AutoState, on: boolean, fn: () => Promise<void>) => {
    setBusy(k); setErr("");
    try { await fn(); setSaved((x) => ({ ...x, [k]: on })); onChanged(); } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong"); } finally { setBusy(""); }
  }, [onChanged]);
  const post = s.publish === "auto" ? t("sa.postAuto", { n: s.publishPerDay ?? 1 }) : s.publish === "off" ? t("sa.postOff") : s.publish ? t("sa.postAsk") : t("sa.unknown");
  return (
    <section className="card space-y-2 text-xs" aria-labelledby="sa-title">
      <h3 id="sa-title" className="hud-title studio-title !text-[0.7rem]">🤖 {t("sa.title").toUpperCase()}</h3>
      <p className="muted">{t("sa.intro")}</p>
      <ul className="space-y-2">
        <Row label={t("sa.autopilot")} what={t("sa.autopilotWhat", { n: s.perDay ?? 1 })} on={s.autopilot} busy={busy === "autopilot"}
          onToggle={(on) => void run("autopilot", on, () => send("/api/studio/autopilot", "PATCH", { auto: on }))} />
        <Row label={t("sa.inbox")} what={t("sa.inboxWhat")} on={s.inbox} busy={inbox.busy} onToggle={inbox.toggle} extra={<>{s.inbox && inbox.layout}{inbox.note}</>} />
        <li className="flex items-start gap-2">
          <span aria-hidden className="mt-0.5 w-[13px] text-center">★</span>
          <span className="min-w-0 flex-1"><b>{t("sa.creators")}</b>
            <span className="muted block">{!s.creators ? t("sa.unknown") : s.creators.total ? t("sa.creatorsWhat", { n: s.creators.auto, total: s.creators.total }) : t("sa.creatorsNone")}</span>
            <button type="button" className="chip mt-0.5 !px-2 !py-0" onClick={onOpenFind}>{t("sa.openFind")}</button></span>
        </li>
        <Row label={t("sa.niche")} what={t("sa.nicheWhat")} on={s.niche} busy={busy === "niche"}
          onToggle={(on) => void run("niche", on, () => send(`${CLIPS}/scout`, "PATCH", { nicheAuto: on }))} />
        <Row label={t("sa.devlog")} what={t("sa.devlogWhat")} on={s.devlog} busy={busy === "devlog"}
          onToggle={(on) => void run("devlog", on, () => send(`${CLIPS}/devlog`, "POST", { enabled: on }))} />
        <li className="flex items-start gap-2 border-t border-white/10 pt-2">
          <span aria-hidden className="mt-0.5 w-[13px] text-center">⬆</span>
          <span className="min-w-0 flex-1"><b>{t("sa.posting")}</b><span className="block">{post}</span>
            <button type="button" className="chip mt-0.5 !px-2 !py-0" onClick={() => nav({ panel: "profile" })}>{t("sa.openAutonomy")}</button></span>
        </li>
      </ul>
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}
