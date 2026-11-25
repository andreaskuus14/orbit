"use client";
import { useCallback, useEffect, useState } from "react";
import type { Open } from "@/lib/clips/pipeline-pure";
import { LF_MAX, LF_MIN, chapterTimes, chaptersText, scriptMd, shotCsv, shotList, stamp, totalSec, type LongJob } from "@/lib/clips/longform-pure";
import { useT } from "./i18n";

// Clip Factory → "Long-form": topic → an 8-12 minute plan (titles, hook, chapters + script + shots, thumbnails, 3 Shorts cut-downs).
// API: /api/studio/longform. Exports are built here. "Price it" only asks Higgsfield the cost; approving happens in AI Story.

async function call<T>(body?: unknown): Promise<T> {
  const res = await fetch("/api/studio/longform", body ? { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}
function download(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "video";

export default function LongformPanel({ active, onOpen }: { active: boolean; onOpen: (o: Open) => void }) {
  const { t } = useT();
  const [plans, setPlans] = useState<LongJob[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [topic, setTopic] = useState(""), [minutes, setMinutes] = useState(10);
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [note, setNote] = useState("");
  const load = useCallback(() => call<{ plans: LongJob[] }>().then((r) => setPlans(r.plans), (e) => setErr(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { if (active) void load(); }, [active, load]);

  async function act(name: string, body: unknown) {
    setBusy(name); setErr(""); setNote("");
    try {
      const r = await call<{ plan: LongJob }>(body);
      setPlans((ps) => [r.plan, ...ps.filter((p) => p.id !== r.plan.id)]); setSel(r.plan.id);
      if (name !== "write") setNote(t("lform.priced"));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); }
  }
  const j = plans.find((p) => p.id === sel) ?? plans[0];
  const p = j?.plan, times = p ? chapterTimes(p) : [];
  const priced = (key: string) => !!j?.drafts.some((d) => d.key === key);
  const price = (key: string, what: unknown) => (
    <button className="chip !px-1.5 !py-0 !text-[10px]" disabled={!!busy || priced(key)} onClick={() => void act(key, { action: "visual", id: j!.id, what })}>
      {priced(key) ? `${t("lform.pricedTag")} ✓` : busy === key ? t("lform.pricing") : t("lform.price")}</button>
  );

  return (
    <div className="space-y-3">
      <section className="card" aria-label={t("lform.newAria")}>
        <h3 className="hud-title studio-title !text-[0.7rem] uppercase">{t("lform.title")}</h3>
        <form className="mt-1.5 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void act("write", { action: "write", topic, minutes }); }}>
          <label className="min-w-0 flex-1 text-[11px]">{t("lform.topic")}
            <input className="field mt-0.5 w-full !px-2 !py-1 !text-xs" value={topic} maxLength={500} onChange={(e) => setTopic(e.target.value)} placeholder={t("lform.topicPh")} /></label>
          <label className="text-[11px]">{t("lform.minutes")}
            <input className="field mt-0.5 w-16 !px-2 !py-1 !text-xs" type="number" min={LF_MIN} max={LF_MAX} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></label>
          <button className="btn !px-3 !py-1 !text-xs" disabled={!!busy || topic.trim().length < 3}>{busy === "write" ? t("lform.writing") : t("lform.write")}</button>
        </form>
        {plans.length > 1 && (
          <label className="muted mt-1.5 block text-[11px]">{t("lform.plan")}{" "}
            <select className="field !px-2 !py-1 !text-xs" value={j?.id} onChange={(e) => setSel(e.target.value)}>
              {plans.map((x) => <option key={x.id} value={x.id}>{x.plan.titles[0]}</option>)}</select></label>
        )}
        {err && <p className="error mt-1 text-[11px]" role="alert">{err}</p>}
        {note && <p className="mt-1 text-[11px]" aria-live="polite">{note}</p>}
      </section>

      {j && p && (
        <section className="card space-y-2 text-[12px]" aria-label={t("lform.planAria")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{p.titles[0]} <span className="muted num text-[11px]">~{stamp(totalSec(p))}</span></h3>
            <div className="flex flex-wrap gap-1">
              <button className="chip !text-[11px]" onClick={() => download(`${slug(p.titles[0])}-script.md`, scriptMd(j), "text/markdown")}>{t("lform.scriptMd")}</button>
              <button className="chip !text-[11px]" onClick={() => download(`${slug(p.titles[0])}-shots.csv`, shotCsv(shotList(p)), "text/csv")}>{t("lform.shotsCsv")}</button>
              <button className="chip !text-[11px]" onClick={() => void navigator.clipboard.writeText(chaptersText(p)).then(() => setNote(t("lform.copied")), () => setErr(t("lform.copyErr")))}>{t("lform.copy")}</button>
            </div>
          </div>
          {j.warning && <p className="error text-[11px]">{j.warning}</p>}
          <div><b className="text-[11px]">{t("lform.titles")}</b><ul className="muted list-disc pl-4">{p.titles.map((x) => <li key={x}>{x}</li>)}</ul></div>
          <details open><summary className="cursor-pointer"><span className="num">0:00</span> {t("lform.intro")}</summary><p className="mt-1 whitespace-pre-wrap">{p.hook}</p></details>
          {p.chapters.map((c, ci) => (
            <details key={ci}><summary className="cursor-pointer"><span className="num">{stamp(times[ci + 1].start)}</span> {c.title} <span className="muted text-[10px]">({stamp(times[ci + 1].sec)})</span></summary>
              <p className="mt-1 whitespace-pre-wrap">{c.script}</p>
              <ul className="mt-1 space-y-0.5 text-[11px]">{c.shots.map((s, i) => (
                <li key={i} className="flex items-center gap-2"><span className="chip !px-1.5 !py-0 !text-[10px]">{s.type}</span><span className="min-w-0 flex-1">{s.desc}</span>
                  {(s.type === "b-roll" || s.type === "graphic") && price(`shot-${ci}-${i}`, { kind: "shot", ch: ci, i })}</li>))}</ul>
            </details>
          ))}
          <div><b className="text-[11px]">{t("lform.thumbs")}</b>
            <ul className="space-y-1">{p.thumbs.map((th, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px]"><span className="min-w-0 flex-1">{th.concept}{th.text && <> · <b>“{th.text}”</b></>}</span>{price(`thumb-${i}`, { kind: "thumb", i })}</li>))}</ul></div>
          <div><b className="text-[11px]">{t("lform.shorts")}</b>
            <ul className="space-y-1">{p.shorts.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px]"><span className="min-w-0 flex-1"><b>{s.title}</b> · {t("lform.from", { ch: p.chapters[s.chapter].title, at: stamp(times[s.chapter + 1].start) })}: {s.idea}</span>
                <button className="chip !px-1.5 !py-0 !text-[10px]" onClick={() => onOpen({ tool: "story", idea: `${s.title}: ${s.idea}` })}>{t("lform.story")}</button></li>))}</ul></div>
          <p className="muted text-[10px]">{t("lform.note")}</p>
        </section>
      )}
    </div>
  );
}
