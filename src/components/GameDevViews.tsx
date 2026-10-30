"use client";
// GAME DEV per-game views (DEV01-03, DEV05, DEV08): project contract, labelled test results, work steps for a backlog item,
// asset register and release package; DEV04 UI kit, DEV07 economy simulator, DEV06 retention import. Everything saves through DevWorld's optimistic commit; rules in lib/gamedev-pure.ts.
import { useState } from "react";
import { useT } from "./i18n";
import type { Bug, DevWorld as World, Game } from "@/lib/devworld-pure";
import {
  ASSET_FORMATS, CONTRACT_FIELDS, DEFAULT_CHECKLIST, EVIDENCE_KINDS, OUTCOMES, WORK_STEPS, assetIssues, contractGaps, nextStep, normalizeEvidence, releaseGaps, workSteps,
  type Asset, type Contract, type Evidence, type EvidenceKind, type Outcome, type Release,
} from "@/lib/gamedev-pure";
import { DEFAULT_KIT, KIT_COLORS, KIT_FONTS, PREVIEW_MODES, SAMPLE_TEXT, abbrev, buttonHeight, kitIssues, kitLuau, type PreviewMode, type UiKit } from "@/lib/gamedev-uikit-pure";
import { SAMPLE_MODEL, SIM_DEFAULTS, findings, parseModel, playOne, sensitivity, simulateModel, type Model, type SimResult } from "@/lib/economy-sim-pure";
import { cohorts, funnelRates, parseExport, type Metric, type Retention } from "@/lib/gamedev-retention-pure";

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

const setGame = (world: World, id: string, patch: Partial<Game>) => ({ ...world, games: world.games.map((g) => (g.id === id ? { ...g, ...patch } : g)) });

/** DEV04: the game's UI kit, previewed in four modes, saved on the game; the Luau module is generated on demand. */
export function UiKitCard({ game, world, commit }: P) {
  const { t } = useT();
  const [k, setK] = useState<UiKit>(game.uikit ?? DEFAULT_KIT);
  const [mode, setMode] = useState<PreviewMode>("short");
  const [code, setCode] = useState("");
  const issues = kitIssues(k, mode), s = mode === "lowres" ? 0.5 : 1, px = (n: number) => Math.round(n * s);
  const num = (f: "body" | "title" | "spacing" | "radius" | "card") => (
    <label key={f} className="text-xs">{t(f === "title" ? "gd.ui.titleSize" : `gd.ui.${f}`)}
      <input className="field mt-0.5 w-16" type="number" min={0} max={400} value={k[f]} onChange={(e) => setK({ ...k, [f]: Math.round(Number(e.target.value) || 0) })} /></label>
  );
  const font = { fontFamily: "system-ui, sans-serif", fontWeight: /Bold|Fredoka|Luckiest|Arcade|Cartoon/.test(k.font) ? 700 : 400 };
  const name = mode === "long" ? SAMPLE_TEXT.long : "Dog";
  return (
    <form className="card space-y-2" aria-label={t("gd.ui.title")} onSubmit={(e) => { e.preventDefault(); commit(setGame(world, game.id, { uikit: k })); }}>
      <div className="hud-title">{t("gd.ui.title")}</div>
      <p className="muted text-xs">{t("gd.ui.help")}</p>
      <div className="flex flex-wrap items-end gap-1.5">
        <label className="text-xs">{t("gd.ui.font")}<select className="field mt-0.5 py-1" value={k.font} onChange={(e) => setK({ ...k, font: e.target.value as UiKit["font"] })}>{KIT_FONTS.map((f) => <option key={f}>{f}</option>)}</select></label>
        {(["body", "title", "spacing", "radius", "card"] as const).map(num)}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {KIT_COLORS.map((c) => <label key={c} className="text-xs">{t(`gd.ui.col.${c}`)}<input className="ml-1 align-middle" type="color" value={k.colors[c]} onChange={(e) => setK({ ...k, colors: { ...k.colors, [c]: e.target.value } })} /></label>)}
      </div>
      <div className="flex gap-1.5">
        <input className="field min-w-0 flex-1" maxLength={24} aria-label={t("gd.ui.currency")} placeholder={t("gd.ui.currency")} value={k.currency} onChange={(e) => setK({ ...k, currency: e.target.value })} />
        <input className="field min-w-0 flex-1" maxLength={40} aria-label={t("gd.ui.icon")} placeholder={t("gd.ui.icon")} value={k.icon} onChange={(e) => setK({ ...k, icon: e.target.value.trim() })} />
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label={t("gd.ui.preview")}>
        {PREVIEW_MODES.map((m) => <button type="button" key={m} className="chip" aria-pressed={mode === m} onClick={() => setMode(m)}>{t(`gd.ui.m.${m}`)}</button>)}
      </div>
      <div aria-hidden className="flex flex-wrap items-start gap-2 rounded p-2" style={{ ...font, background: "#0b1220", maxWidth: mode === "lowres" ? 320 : undefined }}>
        <span style={{ background: k.colors.primary, color: k.colors.primaryText, borderRadius: px(k.radius), padding: `0 ${px(k.spacing)}px`, height: px(buttonHeight(k)), lineHeight: `${px(buttonHeight(k))}px`, fontSize: px(k.body),
          outline: mode === "touch" ? `1px dashed ${buttonHeight(k) < 44 ? "#ef4444" : "#4ade80"}` : undefined, outlineOffset: mode === "touch" ? (44 - buttonHeight(k)) / -2 : undefined }}>{mode === "long" ? "Hatch Legendary Egg ×3" : "Buy"}</span>
        <span style={{ background: k.colors.surface, color: k.colors.accent, borderRadius: px(k.radius), padding: px(k.spacing), fontSize: px(k.body), whiteSpace: "nowrap" }}>{abbrev(mode === "short" ? 999_999 : 1_234_567)} {k.currency}</span>
        <div style={{ background: k.colors.surface, color: k.colors.text, borderRadius: px(k.radius), padding: px(k.spacing), width: px(k.card), fontSize: px(k.body) }}>
          <div style={{ height: px(k.card - 2 * k.spacing), background: "#ffffff14", borderRadius: px(k.radius) / 2 }} />
          <div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.15 }}>{name}</div>
        </div>
        <span style={{ background: k.colors.surface, color: k.colors.success, borderRadius: px(k.radius), padding: px(k.spacing), fontSize: px(k.body) }}>{t("gd.ui.toastOk")}</span>
        <span style={{ background: k.colors.surface, color: k.colors.danger, borderRadius: px(k.radius), padding: px(k.spacing), fontSize: px(k.body) }}>{t("gd.ui.toastErr", { c: k.currency })}</span>
      </div>
      <ul role="status" className="text-xs">{issues.length ? issues.map((i) => <li key={i} className="error">{t(`gd.ui.i.${i}`)}</li>) : <li className="ok">{t("gd.ui.ok")}</li>}</ul>
      <div className="flex flex-wrap gap-1.5">
        <button className="btn">{t("gd.save")}</button>
        <button type="button" className="chip" onClick={() => setCode(kitLuau(k, game.name))}>{t("gd.ui.luau")}</button>
        {code && <button type="button" className="chip" onClick={() => void navigator.clipboard?.writeText(code).catch(() => {})}>{t("gd.ui.copy")}</button>}
      </div>
      {code && <><p className="muted text-xs">{t("gd.ui.luauHelp")}</p><textarea className="field w-full font-mono text-[11px]" rows={10} readOnly value={code} aria-label="Luau" /></>}
    </form>
  );
}

/** DEV07: seeded, game-agnostic economy simulation. The model text is saved on the game when it runs cleanly. */
export function EconomySim({ game, world, commit }: P) {
  const { t } = useT();
  const [text, setText] = useState(game.econ ?? SAMPLE_MODEL);
  const [o, setO] = useState(SIM_DEFAULTS);
  const [out, setOut] = useState<{ m: Model; r: SimResult; errors: string[] } | null>(null);
  const [sens, setSens] = useState<ReturnType<typeof sensitivity> | null>(null);
  const [who, setWho] = useState("");
  const run = (e: React.FormEvent) => {
    e.preventDefault(); setSens(null); setWho("");
    const { model, errors } = parseModel(text);
    setOut({ m: model, r: simulateModel(model, o), errors });
    if (!errors.length && text !== game.econ) commit(setGame(world, game.id, { econ: text }));
  };
  const m1 = (x: number | null) => (x === null ? t("gd.sim.never") : String(x));
  const replay = out && who !== "" ? playOne(out.m, o.seed, Math.max(0, Math.min(o.players - 1, Number(who) - 1 || 0))).events.slice(0, 200) : [];
  return (
    <section className="space-y-2" aria-label={t("gd.sim.title")}>
      <div className="hud-title">{t("gd.sim.title")}</div>
      <p className="text-xs"><KindBadge kind="simulated" /> {t("gd.sim.label")}</p>
      <form className="space-y-1.5" onSubmit={run}>
        <textarea className="field w-full font-mono text-[11px]" rows={9} maxLength={6000} aria-label={t("gd.sim.model")} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex flex-wrap items-end gap-1.5">
          <label className="text-xs">{t("gd.sim.seed")}<input className="field mt-0.5 w-20" type="number" value={o.seed} onChange={(e) => setO({ ...o, seed: Math.floor(Number(e.target.value)) || 0 })} /></label>
          <label className="text-xs">{t("gd.sim.players")}<input className="field mt-0.5 w-20" type="number" min={1} max={500} value={o.players} onChange={(e) => setO({ ...o, players: Math.max(1, Math.min(500, Math.floor(Number(e.target.value)) || 1)) })} /></label>
          <button className="btn">{t("gd.sim.run")}</button>
        </div>
      </form>
      {out && <div className="space-y-1.5 text-xs" role="status">
        {out.errors.map((x) => <p key={x} className="error">{x}</p>)}
        {!out.errors.length && <>
          <ul className="space-y-0.5">{out.r.sinks.map((x) => <li key={x.name}>{t("gd.sim.sink", { name: x.name, price: abbrev(x.price), pct: x.reached, m: m1(x.median), p90: m1(x.p90), share: x.share })}</li>)}</ul>
          <p>{t("gd.sim.flow", { min: out.r.minutes, e: abbrev(out.r.earned), r: abbrev(out.r.rewarded), s: abbrev(out.r.spent), b: abbrev(out.r.endBalance) })}</p>
          {out.r.gap && <p className="muted">{t("gd.sim.gap", { min: out.r.gap.minutes, from: out.r.gap.from })}</p>}
          <ul>{findings(out.r).map((f) => <li key={f.code} className="error">{t(`gd.sim.f.${f.code}`, f.vars)}</li>)}</ul>
          <div className="flex flex-wrap items-end gap-1.5">
            <button className="chip" onClick={() => setSens(sensitivity(out.m, o))}>{t("gd.sim.sens")}</button>
            <label>{t("gd.sim.replay")}<input className="field ml-1 w-16" type="number" min={1} max={o.players} value={who} onChange={(e) => setWho(e.target.value)} /></label>
          </div>
          {sens && (sens.target ? <><p className="muted">{t("gd.sim.sensHelp", { name: sens.target })}</p>
            <ul>{sens.rows.map((x) => <li key={x.input}>{x.input}: ×0.8 {x.down === null ? t("gd.sim.never") : `${x.down > 0 ? "+" : ""}${x.down}`} · ×1.2 {x.up === null ? t("gd.sim.never") : `${x.up > 0 ? "+" : ""}${x.up}`}</li>)}</ul></>
            : <p className="muted">{t("gd.sim.sensNone")}</p>)}
          {replay.length > 0 && <ol className="max-h-40 overflow-y-auto font-mono text-[11px]">{replay.map((e, i) => <li key={i}>{e.min.toFixed(1)}m {e.kind === "buy" ? "−" : "+"} {e.name} → {abbrev(e.balance)}</li>)}</ol>}
        </>}
      </div>}
    </section>
  );
}

/** DEV06: the owner's Roblox analytics export joined to this game's release packages. Descriptive only. */
export function RetentionPanel({ game, world, commit }: P) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string[]>([]);
  const mine = world.retention?.find((r) => r.game === game.id);
  const doImport = () => {
    const p = parseExport(text);
    setMsg([...p.errors, ...(p.ignored.length ? [t("gd.ret.ignored", { list: p.ignored.join(", ") })] : [])]);
    if (!p.rows.length && !p.funnel.length) return;
    const today = now().slice(0, 10), last = p.rows.at(-1)?.date ?? mine?.asOf ?? today;
    const next: Retention = { game: game.id, importedAt: now(), asOf: last < today ? last : today, rows: p.rows.length ? p.rows : mine?.rows ?? [], funnel: p.funnel.length ? p.funnel : mine?.funnel ?? [] };
    if (commit({ ...world, retention: [...(world.retention ?? []).filter((r) => r.game !== game.id), next] })) setText("");
  };
  const rel = (world.releases ?? []).filter((r) => r.game === game.id);
  const pct = (k: string, x: Metric) => (x.value === null ? t("gd.ret.unknown", { k, n: x.immature }) : t("gd.ret.metric", { k, v: Math.round(x.value * 1000) / 10, n: x.n }) + (x.immature ? t("gd.ret.partial", { n: x.immature }) : ""));
  return (
    <section className="space-y-2" aria-label={t("gd.ret.title")}>
      <div className="hud-title">{t("gd.ret.title")}</div>
      <p className="muted text-xs">{t("gd.ret.help")}</p>
      <p className="text-xs">{t("gd.ret.noCause")}</p>
      <label className="block text-xs">{t("gd.ret.file")} <input type="file" accept=".csv,text/csv" onChange={(e) => void e.target.files?.[0]?.text().then(setText)} /></label>
      <textarea className="field w-full font-mono text-[11px]" rows={4} maxLength={200000} placeholder={t("gd.ret.paste")} aria-label={t("gd.ret.paste")} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn" disabled={!text.trim()} onClick={doImport}>{t("gd.ret.import")}</button>
      {msg.map((x) => <p key={x} className="muted text-xs">{x}</p>)}
      {!mine ? <p className="muted text-xs">{t("gd.ret.none")}</p> : <div className="space-y-1.5 text-xs">
        <p className="muted">{t("gd.ret.asOf", { d: mine.asOf, at: new Date(mine.importedAt).toLocaleString() })}</p>
        {cohorts(mine, rel).map((c) => (
          <div key={c.release ?? "before"} className="card space-y-0.5">
            <b>{t("gd.ret.window", { rel: c.release ? c.build || "?" : t("gd.ret.before"), from: c.from, to: c.to, n: c.users, days: c.days })}</b>
            <p>{pct("D1", c.d1)}</p><p>{pct("D7", c.d7)}</p>
            {c.sessions !== null && <p className="muted">{t("gd.ret.sessions", { s: c.sessions, m: c.minutes ?? "?" })}</p>}
            {c.small && <p className="error">{t("gd.ret.small")}</p>}
          </div>
        ))}
        {mine.funnel.length > 0 && <><div className="hud-title">{t("gd.ret.funnel")}</div>
          <ul>{funnelRates(mine.funnel).map((f) => <li key={f.step}>{t("gd.ret.step", { step: f.step, n: f.users, prev: f.fromPrev, start: f.fromStart })}</li>)}</ul></>}
      </div>}
    </section>
  );
}
