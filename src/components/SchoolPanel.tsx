"use client";
// LIFE → School: courses, assignments / studio deadlines and exams, the backward-planned study blocks and week warnings.
// All data via /api/school (local school.json). ARCH links keep a copy of ARCH's scene; "Open in ARCH" puts it back after a confirm.
// On the planet kit (design-language.md): every string is an EN/ET key (sch.*), dialogs are askConfirm, no browser dialogs.
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { KINDS, MAX_NEXT, MAX_SOURCES, PREP_DAYS, dueMs, nextStep, prepDue, type Course, type Plan, type SchoolItem, type Settings } from "@/lib/school-pure";
import { useT } from "./i18n";
import { NAV_EVENT } from "@/lib/nav-pure";
import { Button, Card, Chip, Empty, ErrorState, Loading, Section, askConfirm } from "./ui";
import "@/app/school-panel.css";

type View = { courses: Course[]; items: SchoolItem[]; settings: Settings; plan: Plan };
const ARCH_KEY = "orbit.arch.v1"; // ArchWorld.tsx's saved scene
const day = (t: number) => new Date(t).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function SchoolPanel() {
  const { t } = useT();
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/school");
      if (!r.ok) throw new Error(String(r.status));
      setV(await r.json() as View); setErr(false);
    } catch { setErr(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const [vault, setVault] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { fetch("/api/vault").then((r) => (r.ok ? r.json() : null)).then((j) => setVault((j?.files ?? []).filter((f: { id?: string }) => f.id))).catch(() => {}); }, []);
  const [actErr, setActErr] = useState(false);
  const act = useCallback(async (body: object) => {
    try {
      const r = await fetch("/api/school", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(String(r.status));
      setActErr(false); await load(); return true;
    } catch { setActErr(true); return false; }
  }, [load]);

  if (!v) return <div className="pu sch" data-planet="life">{err ? <ErrorState title={t("sch.loadFail")} text={t("sch.safe")} retryLabel={t("sch.retry")} onRetry={() => void load()} /> : <Loading label={t("sch.loading")} />}</div>;
  const now = Date.now(), title = (id: string) => v.items.find((i) => i.id === id)?.title ?? "";
  const course = (id: string) => v.courses.find((c) => c.id === id)?.name;
  const warn = v.plan.weeks.filter((w) => w.over);
  const soon = v.plan.blocks.filter((b) => b.end > now && b.start < now + 7 * 86_400_000);
  const prep = new Set(prepDue(v.items, now).map((i) => i.id));
  const open = v.items.filter((i) => !i.done).sort((a, b) => dueMs(a.due) - dueMs(b.due));
  return (
    <div className="pu sch" data-planet="life">
      {actErr && <ErrorState title={t("sch.actFail")} text={t("sch.safe")} />}
      {warn.map((w) => (
        <Card key={w.week} tone="needs" title={t("sch.weekOver", { d: day(Date.parse(`${w.week}T12:00`)), h: w.hours, max: v.settings.maxWeek })}
          sub={(w.short ? t("sch.weekShort", { h: w.short }) + " " : "") + t("sch.weekFix")} />
      ))}
      <Section title={t("sch.next7")} count={soon.length}>
        {soon.length ? (
          <ul className="sch-list">
            {soon.map((b) => <li key={b.start}><span className="sch-meta pu-num">{day(b.start)} {time(b.start)}–{time(b.end)}</span> {title(b.itemId)}</li>)}
          </ul>
        ) : <Empty title={t("sch.noBlocks")} />}
        <p className="sch-meta">{t("sch.howPlanned")}</p>
      </Section>

      <AddItem courses={v.courses} act={act} />
      <Section title={t("sch.open")} count={open.length}>
        {open.length ? <ul className="sch-list">
          {open.map((i) => (
            <Card as="li" key={i.id} title={i.title}
              sub={`${t(`sch.kind.${i.kind}`)}${course(i.courseId) ? ` · ${course(i.courseId)}` : ""} · ${t("sch.due", { d: day(dueMs(i.due)) + (i.due.includes("T") ? ` ${time(dueMs(i.due))}` : "") })}`}>
              <Workflow item={i} plan={v.plan} now={now} vault={vault} act={act} />
              <div className="sch-line">
                <label className="sch-meta sch-inline">{t("sch.hoursLeft")} <input className="sch-input sch-num" type="number" min={0} max={200} step={0.5} defaultValue={i.hours}
                  onBlur={(e) => { const h = Number(e.target.value); if (h !== i.hours) void act({ action: "updateItem", id: i.id, hours: h }); }} /></label>
                {v.plan.short[i.id] ? <span className="sch-warn">{t("sch.noFit", { h: v.plan.short[i.id] })}</span> : null}
                {i.prepped && <span className="sch-meta">{t("sch.prepped")}</span>}
              </div>
              <div className="sch-line">
                <Button size="sm" onClick={() => void act({ action: "updateItem", id: i.id, done: true })}>{t("sch.done")}</Button>
                {prep.has(i.id) && <Button size="sm" variant="ghost" title={t("sch.prepTip", { n: PREP_DAYS })} onClick={() => void act({ action: "prep", id: i.id })}>{t("sch.prep")}</Button>}
                {i.kind === "studio" && <ArchLinkButtons item={i} act={act} />}
                <span className="sch-push" />
                <Button size="sm" variant="ghost" label={t("sch.deleteAria", { title: i.title })}
                  onClick={async () => { if (await askConfirm(t("sch.deleteAsk", { title: i.title }), { ok: t("sch.delete"), danger: true })) void act({ action: "removeItem", id: i.id }); }}>{t("sch.delete")}</Button>
              </div>
            </Card>
          ))}
        </ul> : <Empty title={t("sch.noOpen")} text={t("sch.noOpenText")} />}
      </Section>
      <Courses courses={v.courses} act={act} />
      <SettingsCard s={v.settings} act={act} />
    </div>
  );
}

type Act = (body: object) => Promise<boolean>;

/** LIF06: the one next action, the course material (VAULT files by id, so a rename keeps the link) and the way to study cards. */
function Workflow({ item, plan, now, vault, act }: { item: SchoolItem; plan: Plan; now: number; vault: { id: string; name: string }[]; act: Act }) {
  const { t } = useT();
  const n = nextStep(item, plan, now), src = item.sources ?? [];
  const label = n.kind === "own" ? n.text : n.kind === "block" ? t("school.n.block", { t: `${day(n.at)} ${time(n.at)}` }) : n.kind === "short" ? t("school.n.short", { h: n.hours }) : t(`school.n.${n.kind}`);
  const name = (id: string) => vault.find((f) => f.id === id)?.name ?? t("school.gone");
  return (
    <div className="sch-flow">
      <p className="sch-next"><span className="sch-meta">{t("school.next")}:</span> <b>{label}</b></p>
      <input className="sch-input" defaultValue={item.next ?? ""} maxLength={MAX_NEXT} placeholder={t("school.nextPh")} aria-label={t("school.nextAria", { title: item.title })}
        onBlur={(e) => { if (e.target.value.trim() !== (item.next ?? "")) void act({ action: "updateItem", id: item.id, next: e.target.value }); }} />
      <div className="sch-line">
        <span className="sch-meta">{t("school.sources")}:</span>
        {src.map((id) => <button key={id} className="pu-chip" aria-label={t("school.removeSource", { name: name(id) })} onClick={() => act({ action: "updateItem", id: item.id, sources: src.filter((x) => x !== id) })}>{name(id)} ×</button>)}
        {src.length < MAX_SOURCES && vault.length > 0 && (
          <select className="sch-input sch-select" value="" aria-label={t("school.addSource")} onChange={(e) => e.target.value && act({ action: "updateItem", id: item.id, sources: [...src, e.target.value] })}>
            <option value="">{t("school.addSource")}</option>
            {vault.filter((f) => !src.includes(f.id)).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>)}
        <button className="pu-chip sch-push" onClick={() => dispatchEvent(new CustomEvent(NAV_EVENT, { detail: { panel: "memory", study: true } }))}>{t("school.cards")}</button>
      </div>
    </div>
  );
}

function AddItem({ courses, act }: { courses: Course[]; act: Act }) {
  const { t } = useT();
  const [f, setF] = useState({ title: "", kind: "assignment", courseId: "", due: "", time: "", hours: "4" });
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const [busy, setBusy] = useState(false);
  const add = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    if (await act({ action: "addItem", title: f.title, kind: f.kind, courseId: f.courseId, due: f.time ? `${f.due}T${f.time}` : f.due, hours: Number(f.hours) }))
      setF((x) => ({ ...x, title: "", due: "", time: "" }));
    setBusy(false);
  };
  return (
    <form onSubmit={add} className="sch-form">
      <input className="sch-input" value={f.title} onChange={set("title")} placeholder={t("sch.titlePh")} aria-label={t("sch.title")} maxLength={120} required />
      <div className="sch-line">
        <select className="sch-input sch-select" value={f.kind} onChange={set("kind")} aria-label={t("sch.kind")}>{KINDS.map((k) => <option key={k} value={k}>{t(`sch.kind.${k}`)}</option>)}</select>
        <select className="sch-input sch-select" value={f.courseId} onChange={set("courseId")} aria-label={t("sch.course")}><option value="">{t("sch.noCourse")}</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input className="sch-input sch-auto" type="date" value={f.due} onChange={set("due")} aria-label={t("sch.dueDate")} required />
        <input className="sch-input sch-auto" type="time" value={f.time} onChange={set("time")} aria-label={t("sch.dueTime")} />
        <label className="sch-meta sch-inline">{t("sch.estHours")} <input className="sch-input sch-num" type="number" min={0} max={200} step={0.5} value={f.hours} onChange={set("hours")} /></label>
        <span className="sch-push" />
        <Button type="submit" variant="primary" busy={busy} disabled={!f.title.trim() || !f.due}>{t("common.add")}</Button>
      </div>
    </form>
  );
}

function ArchLinkButtons({ item, act }: { item: SchoolItem; act: Act }) {
  const { t } = useT();
  const link = () => {
    let scene: unknown = null;
    try { scene = JSON.parse(localStorage.getItem(ARCH_KEY) ?? "null")?.scene ?? null; } catch { /* private mode */ }
    void act({ action: "linkArch", id: item.id, scene });
  };
  const openIt = async () => {
    if (!(await askConfirm(t("sch.archAsk"), { ok: t("sch.archOpen") }))) return;
    const r = await fetch(`/api/school?arch=${encodeURIComponent(item.id)}`).then((x) => x.json()).catch(() => null);
    if (!r?.scene) return;
    try {
      const cur = JSON.parse(localStorage.getItem(ARCH_KEY) ?? "null");
      localStorage.setItem(ARCH_KEY, JSON.stringify({ scene: r.scene, prices: cur?.prices ?? [] }));
    } catch { return; }
    dispatchEvent(new CustomEvent(NAV_EVENT, { detail: { panel: "arch" } }));
  };
  if (!item.arch) return <Button size="sm" variant="ghost" title={t("sch.archLinkTip")} onClick={link}>{t("sch.archLink")}</Button>;
  return (
    <>
      <Button size="sm" variant="ghost" title={t("sch.archInfo", { n: item.arch.parts, d: new Date(item.arch.at).toLocaleDateString() })} onClick={() => void openIt()}>{t("sch.archOpen")}</Button>
      <Button size="sm" variant="ghost" title={t("sch.archRelinkTip")} onClick={link}>{t("sch.archRelink")}</Button>
      <Button size="sm" variant="ghost" onClick={() => void act({ action: "linkArch", id: item.id, scene: null })}>{t("sch.archUnlink")}</Button>
    </>
  );
}

function Courses({ courses, act }: { courses: Course[]; act: Act }) {
  const { t } = useT();
  const [name, setName] = useState("");
  return (
    <Section title={t("sch.courses")} count={courses.length}>
      <form className="sch-line" onSubmit={async (e) => { e.preventDefault(); if (await act({ action: "addCourse", name })) setName(""); }}>
        <input className="sch-input sch-grow" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("sch.coursePh")} aria-label={t("sch.courseName")} maxLength={80} />
        <Button type="submit" disabled={!name.trim()}>{t("common.add")}</Button>
      </form>
      <div className="sch-line">
        {courses.map((c) => <Chip key={c.id} title={t("sch.courseDelete", { name: c.name })}
          onClick={async () => { if (await askConfirm(t("sch.courseAsk", { name: c.name }), { ok: t("sch.delete"), danger: true })) void act({ action: "removeCourse", id: c.id }); }}>{c.name} ×</Chip>)}
      </div>
    </Section>
  );
}

function SettingsCard({ s, act }: { s: Settings; act: Act }) {
  const { t } = useT();
  const [f, setF] = useState(s);
  useEffect(() => setF(s), [s]);
  const win = (k: "weekday" | "weekend", i: 0 | 1) => (e: ChangeEvent<HTMLInputElement>) => setF((x) => { const w = [...x[k]] as [string, string]; w[i] = e.target.value; return { ...x, [k]: w }; });
  const num = (k: "maxDay" | "maxWeek" | "bufferDays") => (e: ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: Number(e.target.value) }));
  return (
    <details className="sch-details">
      <summary>{t("sch.settings")}</summary>
      <div className="sch-grid">
        <span className="sch-meta">{t("sch.weekdays")}</span><span className="sch-line"><input className="sch-input sch-auto" type="time" value={f.weekday[0]} onChange={win("weekday", 0)} aria-label={t("sch.wdStart")} /><input className="sch-input sch-auto" type="time" value={f.weekday[1]} onChange={win("weekday", 1)} aria-label={t("sch.wdEnd")} /></span>
        <span className="sch-meta">{t("sch.weekends")}</span><span className="sch-line"><input className="sch-input sch-auto" type="time" value={f.weekend[0]} onChange={win("weekend", 0)} aria-label={t("sch.weStart")} /><input className="sch-input sch-auto" type="time" value={f.weekend[1]} onChange={win("weekend", 1)} aria-label={t("sch.weEnd")} /></span>
        <label className="sch-meta" htmlFor="sc-day">{t("sch.maxDay")}</label><input id="sc-day" className="sch-input sch-num" type="number" min={0.5} max={16} step={0.5} value={f.maxDay} onChange={num("maxDay")} />
        <label className="sch-meta" htmlFor="sc-week">{t("sch.maxWeek")}</label><input id="sc-week" className="sch-input sch-num" type="number" min={1} max={80} value={f.maxWeek} onChange={num("maxWeek")} />
        <label className="sch-meta" htmlFor="sc-buf">{t("sch.buffer")}</label><input id="sc-buf" className="sch-input sch-num" type="number" min={0} max={14} value={f.bufferDays} onChange={num("bufferDays")} />
      </div>
      <Button onClick={() => void act({ action: "settings", ...f })}>{t("sch.save")}</Button>
    </details>
  );
}
