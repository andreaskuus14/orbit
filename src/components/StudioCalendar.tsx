"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { weekCalendar, type CalItem, type CalStatus } from "@/lib/clips/calendar-pure";
import type { PublishSettings } from "@/lib/clips/schedule";

// STUDIO week calendar: what goes live today + 6 days (in the publish time zone), with the free slots "Schedule all" would fill.
// Data: the clip jobs ClipFactory already loaded + GET /api/studio/clips/schedule for the slot settings.

type Job = Parameters<typeof weekCalendar>[0][number];
const API = "/api/studio/clips";
const media = (p: string) => `${API}/media?f=${encodeURIComponent(p)}`;
const LABEL: Record<CalStatus, string> = { scheduled: "🕒 Scheduled", published: "✓ Published", failed: "⚠ Failed", pending: "⏳ Uploading" };
const TONE: Partial<Record<CalStatus, { borderColor: string; color: string }>> = { published: { borderColor: "#ff8fab", color: "#ffd6e0" }, failed: { borderColor: "#fb7185", color: "#fda4af" } };

export default function StudioCalendar({ jobs, waiting, scheduleAll, onOpen }: {
  jobs: Job[]; waiting: number; scheduleAll: ReactNode; onOpen: (job: string, clip: string) => void;
}) {
  const [settings, setSettings] = useState<PublishSettings | null>(null);
  const [err, setErr] = useState("");
  // Re-read the slots whenever the jobs reload (the publish form can edit them).
  useEffect(() => {
    fetch(`${API}/schedule`, { cache: "no-store" }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setSettings(j.settings); setErr("");
    }).catch((e: unknown) => setErr(e instanceof Error ? e.message : "Couldn't load the publish slots"));
  }, [jobs]);
  const [picked, setPicked] = useState<CalItem | null>(null);
  const week = useMemo(() => (settings ? weekCalendar(jobs, settings, Date.now()) : []), [jobs, settings]);

  if (err) return <p className="error text-sm" role="alert">{err}</p>;
  if (!settings) return <p className="muted text-sm" role="status">Loading the week…</p>;
  const tz = settings.timezone;
  const time = new Intl.DateTimeFormat([], { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  const dayName = new Intl.DateTimeFormat([], { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
  const free = week.reduce((n, d) => n + d.free.length, 0);

  return (
    <section className="card" aria-label="Publishing week">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="hud-title studio-title !text-[0.7rem]">THIS WEEK</h3>
        <span className="muted text-[11px]">Times in {tz}</span>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span>{waiting} approved clip{waiting === 1 ? "" : "s"} waiting → fill {free} free slot{free === 1 ? "" : "s"}</span>
        {scheduleAll}
      </div>
      <ol className="grid grid-cols-[repeat(7,minmax(7.5rem,1fr))] gap-1.5 overflow-x-auto pb-1" aria-label="Next 7 days">
        {week.map((d, i) => {
          const entries = [...d.items.map((it) => ({ at: it.at, it })), ...d.free.map((at) => ({ at, it: null }))].sort((a, b) => a.at - b.at);
          const name = `${i === 0 ? "Today · " : ""}${dayName.format(Date.UTC(d.y, d.m - 1, d.d, 12))}`;
          return (
            <li key={d.key} className="min-w-0 rounded-xl border border-white/10 p-1.5" style={i === 0 ? { borderColor: "#f43f5e88" } : undefined}>
              <h4 className="muted mb-1 truncate text-[11px] font-semibold uppercase tracking-wide">{name}</h4>
              {!entries.length && <p className="muted text-[11px]">Nothing</p>}
              <ul className="space-y-1" aria-label={name}>
                {entries.map(({ at, it }) => it ? (
                  <li key={`${it.job}/${it.clip}`}>
                    <button className="flex w-full items-center gap-1.5 rounded-lg border border-white/10 p-1 text-left text-[11px] hover:bg-white/5"
                      onClick={() => setPicked(it)} aria-label={`${time.format(at)}: ${it.title}, ${LABEL[it.status]}. Show details`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {it.thumb ? <img src={media(it.thumb)} alt="" loading="lazy" className="h-10 w-6 shrink-0 rounded object-cover" /> : <span aria-hidden className="h-10 w-6 shrink-0 rounded bg-black/40" />}
                      <span className="min-w-0 flex-1">
                        <span className="num block">{time.format(at)}</span>
                        <span className="block truncate" title={it.title}>{it.title}</span>
                        <span className="chip mt-0.5 !cursor-default !px-1.5 !py-0 !text-[9px]" style={TONE[it.status]}>{LABEL[it.status]}</span>
                      </span>
                    </button>
                  </li>
                ) : (
                  <li key={`free-${at}`} className="muted rounded-lg border border-dashed p-1 text-[11px]" style={{ borderColor: "#f43f5e66" }}>
                    <span className="num">{time.format(at)}</span> · free slot
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
      {picked && (
        <div className="mt-2 rounded-xl border border-white/10 p-2 text-xs" role="region" aria-label={`Details: ${picked.title}`}>
          <div className="flex items-start justify-between gap-2">
            <b className="min-w-0 break-words">{picked.title}</b>
            <button className="chip !px-2 !py-0.5" onClick={() => setPicked(null)} aria-label="Close details">×</button>
          </div>
          <p className="muted mt-1">{LABEL[picked.status]} · {new Intl.DateTimeFormat([], { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(picked.at)}</p>
          {picked.error && <p className="error mt-1">{picked.error}</p>}
          <button className="btn mt-2 !px-3 !py-1 !text-xs" onClick={() => onOpen(picked.job, picked.clip)}>Open in Clips</button>
        </div>
      )}
    </section>
  );
}
