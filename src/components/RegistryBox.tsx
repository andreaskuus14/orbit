"use client";
// BUSINESS → e-Business Register: the weekly open-data refresh shown on the shared progress card, and on each lead the
// registry facts, the match confidence, close options for him to pick, and (his eyes only) the board members.
// Rules: lib/registry-pure.ts. Board names are fetched only when he opens them and never leave this card.
import { useCallback, useEffect, useState } from "react";
import { fromStages, type Progress } from "@/lib/progress-pure";
import { ATTRIBUTION, LICENCE_URL, STAGES, TYPICAL_MS, isLinked, resultLine, type Person, type RegMatch, type RunState } from "@/lib/registry-pure";
import { ProgressCard } from "./ProgressCard";
import { useT } from "./i18n";

const API = "/api/business/registry";
async function post(body: object) {
  const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

/** The registry run as one progress card. */
export function registryProgress(s: RunState, running: boolean, lang: "en" | "et", title: string, now = Date.now()): Progress {
  const stages = [...STAGES[lang]], live = running && s.stage >= 0;
  return fromStages({
    id: "registry", title, stages, current: live ? s.stage : s.finishedAt && !s.error ? stages.length : -1,
    failed: !live && !!s.error, error: s.error ? `${lang === "et" ? "Ei õnnestunud" : "Didn't work"}: ${s.error}` : undefined,
    startedAt: live ? s.startedAt : null, typicalMs: TYPICAL_MS,
    result: !live && s.finishedAt && !s.error ? { text: resultLine(s, lang) } : null, at: s.finishedAt ?? s.startedAt ?? new Date(now).toISOString(),
  }, lang, now);
}

export default function RegistryBox({ done }: { done: () => void }) {
  const { t, lang } = useT();
  const [st, setSt] = useState<{ state: RunState; running: boolean } | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => fetch(API, { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((j) => { if (j?.state) setSt(j); return j as { running: boolean }; }), []); // an error reply has no state: keep the box closed, don't crash the sheet
  useEffect(() => { void load().catch(() => {}); }, [load]);
  useEffect(() => { // poll while it runs; reload the leads when it finishes
    if (!st?.running) return;
    const h = setInterval(() => void load().then((j) => { if (!j.running) done(); }).catch(() => {}), 3000);
    return () => clearInterval(h);
  }, [st?.running, load, done]);
  const start = async () => { setErr(""); try { await post({ action: "refresh" }); setTimeout(() => void load(), 500); } catch (e) { setErr((e as Error).message); } };
  const weekly = async (on: boolean) => { try { await post({ action: "weekly", on }); await load(); } catch (e) { setErr((e as Error).message); } };
  const ran = !!st && (st.running || !!st.state.startedAt);
  return (
    <section className="card space-y-2" aria-label={t("biz.reg.title")}>
      <p><b>{t("biz.reg.title")}</b> <span className="muted text-xs">{t("biz.reg.what")}</span></p>
      {st && ran && <ProgressCard p={registryProgress(st.state, st.running, lang, t("biz.reg.card"))} onAction={() => void start()} />}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" disabled={!st || st.running} onClick={() => void start()}>{ran ? t("biz.reg.again") : t("biz.reg.get")}</button>
        {st && ran && <label className="text-xs"><input type="checkbox" checked={st.state.on} onChange={(e) => void weekly(e.target.checked)} /> {t("biz.reg.weekly")}</label>}
      </div>
      {err && <p className="error text-xs" role="alert">{err}</p>}
      <p className="muted text-xs">{t("biz.reg.safe")} <a className="link" href={LICENCE_URL} target="_blank" rel="noreferrer">{ATTRIBUTION}</a></p>
    </section>
  );
}

/** On a lead: the match, its facts, close options to pick, and the board (his eyes only, loaded on open). */
export function RegistryFacts({ id, m, done }: { id: string; m: RegMatch | undefined; done: () => void }) {
  const { t, lang } = useT();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!m) return null;
  const pick = async (code: string) => { setBusy(true); setErr(""); try { await post({ action: "pick", id, code }); done(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const board = () => { if (people === null) void fetch(`${API}?people=${encodeURIComponent(id)}`, { cache: "no-store" }).then((r) => r.json()).then((j) => setPeople(j.people ?? []), () => setPeople([])); };
  if (!isLinked(m)) {
    if (m.state === "none") return <p className="muted text-xs">{t("biz.reg.none")}</p>;
    return (
      <div className="text-xs space-y-1">
        <p className="muted">{m.state === "no-place" ? t("biz.reg.noPlace") : t("biz.reg.ambiguous")}</p>
        {!!m.options?.length && <ul className="space-y-0.5">{m.options.map((o) => (
          <li key={o.code}><button className="chip" disabled={busy} onClick={() => void pick(o.code)}>{t("biz.reg.pick")}</button> {o.name} <span className="muted">· {o.place} · {t("biz.reg.score", { n: o.score })}</span></li>))}</ul>}
        {err && <p className="error" role="alert">{err}</p>}
      </div>
    );
  }
  const i = m.info, closed = i.status !== "active";
  const L = (b: { en: string; et: string } | null) => (b ? b[lang] : t("biz.reg.unknown"));
  return (
    <details className="text-xs" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && board()}>
      <summary className="cursor-pointer">
        <span className={closed ? "error" : "muted"}>{t("biz.reg.summary", { form: i.formShort, code: i.code })} · {t(`biz.reg.status.${i.status}`)}</span>
        {" "}<span className="chip">{m.state === "picked" ? t("biz.reg.picked") : t("biz.reg.score", { n: m.score })}</span>
      </summary>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2">
        <dt className="muted">{t("biz.reg.name")}</dt><dd><a className="link" href={i.link} target="_blank" rel="noreferrer">{i.name}</a></dd>
        <dt className="muted">{t("biz.reg.founded")}</dt><dd>{i.founded || t("biz.reg.unknown")}</dd>
        <dt className="muted">{t("biz.reg.field")}</dt><dd>{i.field ? `${i.field[lang]} (EMTAK ${i.field.code})` : t("biz.reg.unknown")}</dd>
        <dt className="muted">{t("biz.reg.turnover")}</dt><dd>{L(i.turnover)}{i.year ? ` (${i.year})` : ""}</dd>
        <dt className="muted">{t("biz.reg.staff")}</dt><dd>{L(i.staff)}</dd>
        <dt className="muted">{t("biz.reg.board")}</dt>
        <dd>{people === null ? t("common.loading") : people.length ? people.map((p) => `${p.name} (${p.role})`).join(", ") : t("biz.reg.noBoard")}</dd>
      </dl>
      <p className="muted mt-1">{t("biz.reg.private")}</p>
      {closed && <p className="error" role="note">{t("biz.reg.closed")}</p>}
    </details>
  );
}
