"use client";
// LIFE → School: courses, assignments / studio deadlines and exams, the backward-planned study blocks and week warnings.
// All data via /api/school (local school.json). ARCH links keep a copy of ARCH's scene; "Open in ARCH" puts it back after a confirm.
import { useCallback, useEffect, useState } from "react";
import { KINDS, KIND_LABEL, MAX_NEXT, MAX_SOURCES, PREP_DAYS, dueMs, nextStep, prepDue, type Course, type Plan, type SchoolItem, type Settings } from "@/lib/school-pure";
import { useT } from "./i18n";
import { NAV_EVENT } from "@/lib/nav-pure";

type View = { courses: Course[]; items: SchoolItem[]; settings: Settings; plan: Plan };
const ARCH_KEY = "orbit.arch.v1"; // ArchWorld.tsx's saved scene
const day = (t: number) => new Date(t).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function SchoolPanel() {
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/school"), j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setV(j as View); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const [vault, setVault] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { fetch("/api/vault").then((r) => (r.ok ? r.json() : null)).then((j) => setVault((j?.files ?? []).filter((f: { id?: string }) => f.id))).catch(() => {}); }, []);
  const act = useCallback(async (body: object) => {
    try {
      const r = await fetch("/api/school", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      await load(); return true;
    } catch (e) { setErr((e as Error).message); return false; }
  }, [load]);

  if (!v) return err ? <p className="error" role="alert">{err}</p> : <p className="muted text-sm">Loading…</p>;
  const now = Date.now(), title = (id: string) => v.items.find((i) => i.id === id)?.title ?? "";
  const course = (id: string) => v.courses.find((c) => c.id === id)?.name;
  const warn = v.plan.weeks.filter((w) => w.over);
  const soon = v.plan.blocks.filter((b) => b.end > now && b.start < now + 7 * 86_400_000);
  const prep = new Set(prepDue(v.items, now).map((i) => i.id));
  const open = v.items.filter((i) => !i.done).sort((a, b) => dueMs(a.due) - dueMs(b.due));
  return (
    <div className="space-y-3">
      {err && <p className="error" role="alert">{err}</p>}
      {warn.map((w) => (
        <p key={w.week} className="card text-sm" role="status" style={{ borderColor: "var(--amber, #f59e0b)" }}>
          ⚠ Week of {day(Date.parse(`${w.week}T12:00`))}: {w.hours} h planned (limit {v.settings.maxWeek} h){w.short ? `, ${w.short} h won't fit before deadlines` : ""}. Start earlier or lower the estimates.
        </p>
      ))}
      <div className="card space-y-1">
        <b className="text-sm">Next 7 days</b>
        {soon.length ? (
          <ul className="text-sm space-y-0.5">
            {soon.map((b) => <li key={b.start}><span className="muted">{day(b.start)} {time(b.start)}–{time(b.end)}</span> · {title(b.itemId)}</li>)}
          </ul>
        ) : <p className="muted text-xs">No study blocks planned this week.</p>}
        <p className="muted text-xs">Planned backwards from each deadline into your study window, never in quiet hours (23–08) or on calendar events.</p>
      </div>

      <AddItem courses={v.courses} act={act} />
      <ul className="space-y-2">
        {open.map((i) => (
          <li key={i.id} className="card text-sm space-y-1">
            <div className="flex items-baseline gap-2">
              <span className="flex-1"><b>{i.title}</b> <span className="muted text-xs">{KIND_LABEL[i.kind]}{course(i.courseId) ? ` · ${course(i.courseId)}` : ""}</span></span>
              <span className="muted text-xs">due {day(dueMs(i.due))}{i.due.includes("T") ? ` ${time(dueMs(i.due))}` : ""}</span>
            </div>
            <Workflow item={i} plan={v.plan} now={now} vault={vault} act={act} />
            <div className="flex flex-wrap items-center gap-1.5">
              <label className="muted text-xs">Hours left <input className="field w-16" type="number" min={0} max={200} step={0.5} defaultValue={i.hours}
                onBlur={(e) => { const h = Number(e.target.value); if (h !== i.hours) void act({ action: "updateItem", id: i.id, hours: h }); }} /></label>
              {v.plan.short[i.id] ? <span className="text-xs" style={{ color: "var(--amber, #f59e0b)" }}>{v.plan.short[i.id]} h don&apos;t fit</span> : null}
              <button className="chip" onClick={() => act({ action: "updateItem", id: i.id, done: true })}>Done</button>
              {prep.has(i.id) && <button className="chip" title={`Queue a reading list for tonight's night shift (due within ${PREP_DAYS} days)`} onClick={() => act({ action: "prep", id: i.id })}>Prep tonight</button>}
              {i.prepped && <span className="muted text-xs">🌙 reading list queued</span>}
              {i.kind === "studio" && <ArchLinkButtons item={i} act={act} />}
              <button className="chip ml-auto" aria-label={`Delete ${i.title}`} onClick={() => { if (confirm(`Delete “${i.title}”?`)) void act({ action: "removeItem", id: i.id }); }}>Delete</button>
            </div>
          </li>
        ))}
        {!open.length && <li className="muted text-sm">No open work. Add a course, then its assignments, studio deadlines and exams.</li>}
      </ul>
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
    <div className="space-y-1 text-xs">
      <p><span className="muted">{t("school.next")}:</span> <b>{label}</b></p>
      <input className="field w-full" defaultValue={item.next ?? ""} maxLength={MAX_NEXT} placeholder={t("school.nextPh")} aria-label={t("school.nextAria", { title: item.title })}
        onBlur={(e) => { if (e.target.value.trim() !== (item.next ?? "")) void act({ action: "updateItem", id: item.id, next: e.target.value }); }} />
      <div className="flex flex-wrap items-center gap-1">
        <span className="muted">{t("school.sources")}:</span>
        {src.map((id) => <button key={id} className="chip !py-0" aria-label={t("school.removeSource", { name: name(id) })} onClick={() => act({ action: "updateItem", id: item.id, sources: src.filter((x) => x !== id) })}>{name(id)} ×</button>)}
        {src.length < MAX_SOURCES && vault.length > 0 && (
          <select className="field !py-0" value="" aria-label={t("school.addSource")} onChange={(e) => e.target.value && act({ action: "updateItem", id: item.id, sources: [...src, e.target.value] })}>
            <option value="">{t("school.addSource")}</option>
            {vault.filter((f) => !src.includes(f.id)).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>)}
        <button className="chip !py-0 ml-auto" onClick={() => dispatchEvent(new CustomEvent(NAV_EVENT, { detail: { panel: "memory", study: true } }))}>{t("school.cards")}</button>
      </div>
    </div>
  );
}

function AddItem({ courses, act }: { courses: Course[]; act: Act }) {
  const [f, setF] = useState({ title: "", kind: "assignment", courseId: "", due: "", time: "", hours: "4" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await act({ action: "addItem", title: f.title, kind: f.kind, courseId: f.courseId, due: f.time ? `${f.due}T${f.time}` : f.due, hours: Number(f.hours) }))
      setF((x) => ({ ...x, title: "", due: "", time: "" }));
  };
  return (
    <form onSubmit={add} className="card space-y-2">
      <input className="field w-full" value={f.title} onChange={set("title")} placeholder="Assignment, studio project or exam" aria-label="Title" maxLength={120} required />
      <div className="flex flex-wrap gap-2">
        <select className="field" value={f.kind} onChange={set("kind")} aria-label="Kind">{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
        <select className="field" value={f.courseId} onChange={set("courseId")} aria-label="Course"><option value="">No course</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input className="field" type="date" value={f.due} onChange={set("due")} aria-label="Due date" required />
        <input className="field" type="time" value={f.time} onChange={set("time")} aria-label="Due time (optional)" />
        <label className="muted text-xs flex items-center gap-1">Est. hours <input className="field w-16" type="number" min={0} max={200} step={0.5} value={f.hours} onChange={set("hours")} /></label>
        <button className="btn ml-auto" disabled={!f.title.trim() || !f.due}>Add</button>
      </div>
    </form>
  );
}

function ArchLinkButtons({ item, act }: { item: SchoolItem; act: Act }) {
  const link = () => {
    let scene: unknown = null;
    try { scene = JSON.parse(localStorage.getItem(ARCH_KEY) ?? "null")?.scene ?? null; } catch { /* private mode */ }
    void act({ action: "linkArch", id: item.id, scene });
  };
  const openIt = async () => {
    if (!confirm("Load this project's ARCH model? It replaces the model currently open in ARCH (link that one first to keep it).")) return;
    const r = await fetch(`/api/school?arch=${encodeURIComponent(item.id)}`).then((x) => x.json()).catch(() => null);
    if (!r?.scene) return;
    try {
      const cur = JSON.parse(localStorage.getItem(ARCH_KEY) ?? "null");
      localStorage.setItem(ARCH_KEY, JSON.stringify({ scene: r.scene, prices: cur?.prices ?? [] }));
    } catch { return; }
    dispatchEvent(new CustomEvent(NAV_EVENT, { detail: { panel: "arch" } }));
  };
  if (!item.arch) return <button className="chip" title="Link the model currently in ARCH to this studio project" onClick={link}>Link ARCH model</button>;
  return (
    <>
      <button className="chip" title={`${item.arch.parts} parts, linked ${new Date(item.arch.at).toLocaleDateString()}`} onClick={openIt}>Open in ARCH</button>
      <button className="chip" title="Replace with the model currently in ARCH" onClick={link}>Re-link</button>
      <button className="chip" onClick={() => act({ action: "linkArch", id: item.id, scene: null })}>Unlink</button>
    </>
  );
}

function Courses({ courses, act }: { courses: Course[]; act: Act }) {
  const [name, setName] = useState("");
  return (
    <div className="card space-y-2">
      <b className="text-sm">Courses</b>
      <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (await act({ action: "addCourse", name })) setName(""); }}>
        <input className="field flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Architectural design studio 1" aria-label="Course name" maxLength={80} />
        <button className="btn" disabled={!name.trim()}>Add</button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {courses.map((c) => <button key={c.id} className="chip" aria-label={`Delete course ${c.name}`} title="Delete" onClick={() => { if (confirm(`Delete course “${c.name}”?`)) void act({ action: "removeCourse", id: c.id }); }}>{c.name} ✕</button>)}
      </div>
    </div>
  );
}

function SettingsCard({ s, act }: { s: Settings; act: Act }) {
  const [f, setF] = useState(s);
  useEffect(() => setF(s), [s]);
  const win = (k: "weekday" | "weekend", i: 0 | 1) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => { const w = [...x[k]] as [string, string]; w[i] = e.target.value; return { ...x, [k]: w }; });
  const num = (k: "maxDay" | "maxWeek" | "bufferDays") => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: Number(e.target.value) }));
  return (
    <details className="card text-sm">
      <summary>Study window and limits</summary>
      <div className="grid grid-cols-2 gap-2 mt-2 items-center">
        <span className="muted text-xs">Weekdays</span><span className="flex gap-1"><input className="field" type="time" value={f.weekday[0]} onChange={win("weekday", 0)} aria-label="Weekday start" /><input className="field" type="time" value={f.weekday[1]} onChange={win("weekday", 1)} aria-label="Weekday end" /></span>
        <span className="muted text-xs">Weekends</span><span className="flex gap-1"><input className="field" type="time" value={f.weekend[0]} onChange={win("weekend", 0)} aria-label="Weekend start" /><input className="field" type="time" value={f.weekend[1]} onChange={win("weekend", 1)} aria-label="Weekend end" /></span>
        <label className="muted text-xs" htmlFor="sc-day">Max hours a day</label><input id="sc-day" className="field w-20" type="number" min={0.5} max={16} step={0.5} value={f.maxDay} onChange={num("maxDay")} />
        <label className="muted text-xs" htmlFor="sc-week">Warn above hours a week</label><input id="sc-week" className="field w-20" type="number" min={1} max={80} value={f.maxWeek} onChange={num("maxWeek")} />
        <label className="muted text-xs" htmlFor="sc-buf">Finish days before deadline</label><input id="sc-buf" className="field w-20" type="number" min={0} max={14} value={f.bufferDays} onChange={num("bufferDays")} />
      </div>
      <button className="btn mt-2" onClick={() => act({ action: "settings", ...f })}>Save</button>
    </details>
  );
}
