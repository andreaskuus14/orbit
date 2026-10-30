"use client";
// GAME DEV per-game views (DEV01-03, DEV05, DEV08): project contract, labelled test results, work steps for a backlog item,
// asset register and release package. Everything saves through DevWorld's optimistic commit; rules in lib/gamedev-pure.ts.
import { useState } from "react";
import { useT } from "./i18n";
import type { Bug, DevWorld as World, Game } from "@/lib/devworld-pure";
import {
  ASSET_FORMATS, CONTRACT_FIELDS, DEFAULT_CHECKLIST, EVIDENCE_KINDS, OUTCOMES, WORK_STEPS, assetIssues, contractGaps, nextStep, normalizeEvidence, releaseGaps, workSteps,
  type Asset, type Contract, type Evidence, type EvidenceKind, type Outcome, type Release,
} from "@/lib/gamedev-pure";

type P = { game: Game; world: World; commit: (w: World) => boolean };
const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();

export function ContractCard({ game, world, commit }: P) {
  const { t } = useT();
  const [c, setC] = useState<Contract>(game.contract ?? {});
  const gaps = contractGaps(game.contract);
  return (
    <form className="card space-y-1.5" aria-label={t("gd.contract")} onSubmit={(e) => { e.preventDefault(); commit({ ...world, games: world.games.map((g) => (g.id === game.id ? { ...g, contract: c } : g)) }); }}>
      <div className="hud-title">{t("gd.contract")}</div>
      <p className="muted text-xs">{t("gd.contractHelp")}</p>
      {CONTRACT_FIELDS.map((k) => (
        <label key={k} className="block text-xs">{t(`gd.c.${k}`)}<input className="field mt-0.5 w-full" maxLength={200} value={c[k] ?? ""} onChange={(e) => setC({ ...c, [k]: e.target.value })} /></label>
      ))}
      {gaps.length > 0 && <p className="muted text-xs">{t("gd.gaps", { list: gaps.map((k) => t(`gd.c.${k}`)).join(", ") })}</p>}
      <button className="btn">{t("gd.save")}</button>
    </form>
  );
}

export const KindBadge = ({ kind }: { kind: EvidenceKind }) => {
  const { t } = useT();
  return <span className="chip text-[11px]" style={{ borderColor: kind === "runtime" || kind === "player" ? "var(--mint)" : "#f59e0b" }}>{t(`gd.k.${kind}`)}</span>;
};

/** DEV03: every result carries its kind, environment, build and actions; normalizeEvidence decides what may count as passed. */
export function EvidenceLog({ game, world, commit }: P) {
  const { t } = useT();
  const blank = { kind: "runtime" as EvidenceKind, outcome: "fail" as Outcome, env: "Roblox Studio", build: game.contract?.build ?? "", actions: "", summary: "", bugId: "" };
  const [d, setD] = useState(blank);
  const mine = (world.evidence ?? []).filter((e) => e.game === game.id).slice().reverse();
  const items = world.bugs.filter((b) => b.game === game.id);
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value });
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.summary.trim()) return;
    const ev: Evidence = normalizeEvidence({ id: newId(), game: game.id, kind: d.kind, outcome: d.outcome, env: d.env, build: d.build, actions: d.actions, summary: d.summary, at: now(), ...(d.bugId && { bugId: d.bugId }) });
    if (commit({ ...world, evidence: [...(world.evidence ?? []), ev] })) setD({ ...blank, kind: d.kind, env: d.env, build: d.build });
  };
  return (
    <section className="space-y-2" aria-label={t("gd.ev.title")}>
      <div className="hud-title">{t("gd.ev.title")}</div>
      <p className="muted text-xs">{t("gd.ev.help")}</p>
      <ul className="space-y-1.5">
        {mine.map((e) => (
          <li key={e.id} className="card space-y-1 text-xs">
            <div className="flex flex-wrap items-center gap-1.5"><KindBadge kind={e.kind} /><b>{t(`gd.o.${e.outcome}`)}</b><span className="muted">{e.env} · {e.build || "?"} · {new Date(e.at).toLocaleString()}</span></div>
            <p className="whitespace-pre-wrap">{e.summary}</p>
            {e.actions && <p className="muted whitespace-pre-wrap">{t("gd.actions")}: {e.actions}</p>}
            {e.kind === "simulated" && <p className="muted">{t("gd.simNote")}</p>}
          </li>
        ))}
      </ul>
      <form className="space-y-1.5" onSubmit={add}>
        <div className="flex flex-wrap gap-1.5">
          <select className="field py-1" aria-label="Kind" value={d.kind} onChange={set("kind")}>{EVIDENCE_KINDS.map((k) => <option key={k} value={k}>{t(`gd.k.${k}`)}</option>)}</select>
          <select className="field py-1" aria-label="Outcome" value={d.outcome} onChange={set("outcome")}>{OUTCOMES.map((o) => <option key={o} value={o}>{t(`gd.o.${o}`)}</option>)}</select>
          <select className="field py-1" aria-label={t("gd.item")} value={d.bugId} onChange={set("bugId")}><option value="">{t("gd.item")}: {t("gd.none")}</option>{items.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}</select>
        </div>
        <div className="flex gap-1.5">
          <input className="field min-w-0 flex-1" maxLength={120} placeholder={t("gd.env")} aria-label={t("gd.env")} value={d.env} onChange={set("env")} />
          <input className="field min-w-0 flex-1" maxLength={80} placeholder={t("gd.build")} aria-label={t("gd.build")} value={d.build} onChange={set("build")} />
        </div>
        <textarea className="field w-full" rows={2} maxLength={1000} placeholder={t("gd.actions")} aria-label={t("gd.actions")} value={d.actions} onChange={set("actions")} />
        <textarea className="field w-full" rows={2} maxLength={2000} required placeholder={t("gd.summary")} aria-label={t("gd.summary")} value={d.summary} onChange={set("summary")} />
        <button className="btn" disabled={!d.summary.trim()}>{t("gd.add")}</button>
      </form>
    </section>
  );
}

/** DEV02: where a backlog item is on reproduce → change → checks → review. */
export function WorkStepsLine({ bug, world }: { bug: Bug; world: World }) {
  const { t } = useT();
  const s = workSteps(bug, world.trails?.find((x) => x.bugId === bug.id), world.evidence ?? []);
  const next = nextStep(s);
  return (
    <p className="text-[11px]" aria-label={next ? t("gd.next", { s: t(`gd.step.${next}`) }) : t("gd.done")}>
      {WORK_STEPS.map((k) => <span key={k} className={s[k] ? "ok" : "muted"}>{s[k] ? "✓" : "○"} {t(`gd.step.${k}`)}  </span>)}
      <b>{next ? t("gd.next", { s: t(`gd.step.${next}`) }) : t("gd.done")}</b>
    </p>
  );
}

export function AssetRegister({ game, world, commit }: P) {
  const { t } = useT();
  const blank = { name: "", width: "", height: "", format: "png" as Asset["format"], source: "", license: "", generation: "", use: "", preview: true };
  const [d, setD] = useState(blank);
  const mine = (world.assets ?? []).filter((a) => a.game === game.id);
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  const put = (assets: Asset[]) => commit({ ...world, assets });
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.name.trim()) return;
    const a: Asset = { id: newId(), game: game.id, name: d.name, format: d.format, source: d.source, license: d.license, use: d.use, preview: d.preview };
    const w = parseInt(d.width, 10), h = parseInt(d.height, 10);
    if (w > 0) a.width = w; if (h > 0) a.height = h; if (d.generation.trim()) a.generation = d.generation;
    if (put([...(world.assets ?? []), a])) setD(blank);
  };
  return (
    <section className="space-y-2" aria-label={t("gd.as.title")}>
      <div className="hud-title">{t("gd.as.title")}</div>
      <ul className="space-y-1.5">
        {mine.map((a) => {
          const issues = assetIssues(a, game.platform);
          return (
            <li key={a.id} className="card text-xs">
              <div className="flex items-start justify-between gap-2">
                <span><b>{a.name}</b> · {a.format}{a.width ? ` · ${a.width}×${a.height ?? "?"}` : ""} · {a.use || "?"}</span>
                <button className="chip" aria-label={`${t("gd.delete")} ${a.name}`} onClick={() => put((world.assets ?? []).filter((x) => x.id !== a.id))}>{t("gd.delete")}</button>
              </div>
              <p className="muted">{a.source || "?"} · {a.license || "?"}{a.generation ? ` · ${a.generation}` : ""}</p>
              <p className={issues.length ? "error" : "ok"}>{issues.length ? t("gd.as.notReady", { list: issues.join(", ") }) : t("gd.as.ready")}</p>
              {a.preview && <label className="text-xs"><input type="checkbox" checked onChange={() => put((world.assets ?? []).map((x) => (x.id === a.id ? { ...x, preview: false } : x)))} /> {t("gd.as.preview")}</label>}
            </li>
          );
        })}
      </ul>
      <form className="space-y-1.5" onSubmit={add}>
        <div className="flex flex-wrap gap-1.5">
          <input className="field min-w-0 flex-1" required maxLength={80} placeholder={t("gd.as.name")} aria-label={t("gd.as.name")} value={d.name} onChange={set("name")} />
          <select className="field py-1" aria-label={t("gd.as.format")} value={d.format} onChange={set("format")}>{ASSET_FORMATS.map((f) => <option key={f}>{f}</option>)}</select>
          <input className="field w-20" inputMode="numeric" placeholder={t("gd.as.w")} aria-label={t("gd.as.w")} value={d.width} onChange={set("width")} />
          <input className="field w-20" inputMode="numeric" placeholder={t("gd.as.h")} aria-label={t("gd.as.h")} value={d.height} onChange={set("height")} />
        </div>
        <div className="flex gap-1.5">
          <input className="field min-w-0 flex-1" maxLength={200} placeholder={t("gd.as.source")} aria-label={t("gd.as.source")} value={d.source} onChange={set("source")} />
          <input className="field min-w-0 flex-1" maxLength={80} placeholder={t("gd.as.license")} aria-label={t("gd.as.license")} value={d.license} onChange={set("license")} />
        </div>
        <input className="field w-full" maxLength={500} placeholder={t("gd.as.gen")} aria-label={t("gd.as.gen")} value={d.generation} onChange={set("generation")} />
        <input className="field w-full" maxLength={200} placeholder={t("gd.as.use")} aria-label={t("gd.as.use")} value={d.use} onChange={set("use")} />
        <label className="block text-xs"><input type="checkbox" checked={d.preview} onChange={set("preview")} /> {t("gd.as.preview")}</label>
        <button className="btn" disabled={!d.name.trim()}>{t("gd.add")}</button>
      </form>
    </section>
  );
}

/** DEV08: the package the owner reviews; ORBIT has no publish action, he publishes the build himself. */
export function ReleasePanel({ game, world, commit }: P) {
  const { t } = useT();
  const mine = (world.releases ?? []).filter((r) => r.game === game.id).slice().reverse();
  const ev = (world.evidence ?? []).filter((e) => e.game === game.id);
  const put = (r: Release) => commit({ ...world, releases: (world.releases ?? []).map((x) => (x.id === r.id ? r : x)) });
  const create = () => commit({ ...world, releases: [...(world.releases ?? []), {
    id: newId(), game: game.id, build: game.contract?.build ?? "", changes: "", issues: "", rollback: "", at: now(),
    checklist: DEFAULT_CHECKLIST.map((text) => ({ text, done: false })), evidenceIds: [] }] });
  return (
    <section className="space-y-2" aria-label={t("gd.rel.title")}>
      <div className="flex items-center justify-between"><div className="hud-title">{t("gd.rel.title")}</div><button className="chip" onClick={create} disabled={(world.releases?.length ?? 0) >= 50}>{t("gd.rel.new")}</button></div>
      {mine.map((r) => <ReleaseCard key={r.id} r={r} ev={ev} gaps={releaseGaps(r, world)} onSave={put} onDelete={() => commit({ ...world, releases: (world.releases ?? []).filter((x) => x.id !== r.id) })} />)}
    </section>
  );
}

function ReleaseCard({ r: init, ev, gaps, onSave, onDelete }: { r: Release; ev: Evidence[]; gaps: string[]; onSave: (r: Release) => void; onDelete: () => void }) {
  const { t } = useT();
  const [r, setR] = useState(init);
  const f = (k: "build" | "changes" | "issues" | "rollback") => ({ value: r[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setR({ ...r, [k]: e.target.value }), onBlur: () => onSave(r) });
  const save = (next: Release) => { setR(next); onSave(next); };
  return (
    <div className="card space-y-1.5 text-xs">
      <label className="block">{t("gd.build")}<input className="field mt-0.5 w-full" maxLength={80} {...f("build")} /></label>
      <label className="block">{t("gd.rel.changes")}<textarea className="field mt-0.5 w-full" rows={2} maxLength={2000} {...f("changes")} /></label>
      <label className="block">{t("gd.rel.issues")}<textarea className="field mt-0.5 w-full" rows={2} maxLength={2000} {...f("issues")} /></label>
      <label className="block">{t("gd.rel.rollback")}<input className="field mt-0.5 w-full" maxLength={200} {...f("rollback")} /></label>
      {r.checklist.map((c, i) => (
        <label key={i} className="block"><input type="checkbox" checked={c.done} onChange={() => save({ ...r, checklist: r.checklist.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) })} /> {c.text}</label>
      ))}
      <fieldset><legend>{t("gd.rel.evidence")}</legend>
        {ev.map((e) => (
          <label key={e.id} className="block"><input type="checkbox" checked={r.evidenceIds.includes(e.id)}
            onChange={() => save({ ...r, evidenceIds: r.evidenceIds.includes(e.id) ? r.evidenceIds.filter((x) => x !== e.id) : [...r.evidenceIds, e.id] })} /> <KindBadge kind={e.kind} /> {t(`gd.o.${e.outcome}`)} · {e.build || "?"} · {e.summary.slice(0, 60)}</label>
        ))}
      </fieldset>
      <p role="status" className={gaps.length ? "muted" : "ok"}>{gaps.length ? t("gd.rel.gaps", { list: gaps.join(", ") }) : t("gd.rel.ready")}</p>
      <button className="chip" onClick={onDelete}>{t("gd.delete")}</button>
    </div>
  );
}
