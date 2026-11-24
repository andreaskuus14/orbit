"use client";
// Home desk (owner 21 Nov: "I have a problem → ORBIT fixes it → I can see the progress"): one plain status line, the few things
// ORBIT is working on as "Working on it" cards (ProgressCard), and the Needs-you count. It sits right above the one input.
// Everything else (planets, panels, settings) is one tap away. Reads tasks only; never acts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fromTask, sortProgress, statusLine, type Progress } from "@/lib/progress-pure";
import { STOP_ALL_EVENT, STOP_ALL_REQUEST_EVENT, type StopAllDetail } from "@/lib/stop-all-pure";
import { runSeconds } from "@/lib/task-line-pure";
import { usePoll, sharedJson } from "./use-poll";
import { ProgressList, openProgress } from "./ProgressCard";
import { RadarCards } from "./DreamRadar";
import { useT } from "./i18n";
import { IconChevron, IconClose } from "./ui/icons";
import { badge } from "@/lib/home-ui-pure";
import { uiSound } from "./ui/sound";

const COLS = "id,title,status,result,error,created_at,started_at,finished_at,trace,pending";
const SHOWN = 2; // home stays calm: the two that matter most (needs-you first), the rest behind "See all"
const FOLD_KEY = "orbit.home.fold.v2";

/** Median run time of the finished tasks in the list (ms), the basis for "about X min left"; null with fewer than 3. */
function typical(rows: { started_at?: string | null; finished_at?: string | null }[]): number | null {
  const s = rows.map((r) => runSeconds({ started_at: r.started_at ?? null, finished_at: r.finished_at ?? null })).filter((x): x is number => x !== null).sort((a, b) => a - b);
  return s.length >= 3 ? s[Math.floor(s.length / 2)] * 1000 : null;
}

export function HomeDesk({ refresh, onOpenNeeds, onOpenAll, onOpenTask, onNeeds, onProgress }: {
  onNeeds?: (cards: Progress[]) => void; // the tasks waiting for him, so the Needs-you inbox shows the same cards
  onProgress?: (cards: Progress[]) => void; // all active/recent progress cards, shared with the living galaxy
  refresh: number;                // bumps on agent events (Orbit's running list), so a card moves at once
  onOpenNeeds: () => void; onOpenAll: () => void; onOpenTask: (id: string) => void;
}) {
  const { t, lang } = useT();
  const sb = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Parameters<typeof fromTask>[0][] | null>(null);
  const [failed, setFailed] = useState(false);
  const [needs, setNeeds] = useState<number | null>(null);
  const [pilots, setPilots] = useState<Progress[]>([]); // autopilot projects: one card each (api/goals?cards=1, pilot-pure fromPilot)
  const [research, setResearch] = useState<Progress[]>([]); // deep research runs (api/research, research-pure researchCard)
  const [stopAll, setStopAll] = useState(false);
  const [fold, setFold] = useState(true);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(FOLD_KEY) === "0") setFold(false);
    } catch { /* no storage */ }
  }, []);
  useEffect(() => {
    const on = (e: Event) => setStopAll(!!(e as CustomEvent<StopAllDetail>).detail?.on);
    addEventListener(STOP_ALL_EVENT, on); dispatchEvent(new Event(STOP_ALL_REQUEST_EVENT));
    return () => removeEventListener(STOP_ALL_EVENT, on);
  }, []);

  const load = useCallback(() => {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    void sb.from("tasks").select(COLS).is("parent_id", null).or(`status.in.(running,awaiting_approval,queued),finished_at.gte.${since}`)
      .order("created_at", { ascending: false }).limit(12)
      .then(({ data, error }) => { if (error || !data) { setFailed(true); return; } setFailed(false); setRows(data as Parameters<typeof fromTask>[0][]); }, () => setFailed(true));
    void sharedJson<{ cards?: Progress[] }>(`/api/goals?cards=1&lang=${lang}`).then((j) => setPilots(Array.isArray(j?.cards) ? j.cards : []));
    void sharedJson<{ cards?: Progress[] }>("/api/research").then((j) => setResearch(Array.isArray(j?.cards) ? j.cards : []));
    void sharedJson<{ items?: unknown[] }>(`/api/needs-you?lang=${lang}`).then((j) => setNeeds(j?.items ? j.items.length : null));
  }, [sb, lang]);
  usePoll(load, 20_000);
  useEffect(() => { if (refresh) load(); }, [refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const nowMs = Date.now();
  // A project's own step tasks are already on its card, so they don't get cards of their own.
  const items: Progress[] | null = rows ? sortProgress([...pilots, ...research, ...rows.filter((r) => !(/^Goal step /.test(r.title) && pilots.some((p) => r.title.includes(` · ${p.title.replace(/^🧭 /, "")}:`)))).map((r) => fromTask(r, lang, { nowMs, typicalMs: typical(rows), stopAll }))]) : null;
  // Needs-you items that aren't tasks (approvals, blockers…) add to the count; tasks waiting for him are already in the list.
  const needN = Math.max(needs ?? 0, items?.filter((p) => p.phase === "needs").length ?? 0);
  // the Needs-you chip beside it carries the count: the line says what runs and what finished (it used to repeat "2 need you" and wrap)
  const line = items ? statusLine(items.filter((p) => p.phase !== "needs"), lang, nowMs, 0) : t("common.loading");
  const needCards = items?.filter((p) => p.phase === "needs") ?? [];
  const needKey = needCards.map((p) => p.id).join(",");
  const lastNeed = useRef<number | null>(null); // a new item waiting for his click plays the soft "needs" sound once (not on first load)
  useEffect(() => { if (!items) return; if (lastNeed.current !== null && needN > lastNeed.current) uiSound("needs"); lastNeed.current = needN; }, [needN, !!items]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onNeeds?.(needCards); }, [needKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const progKey = (items ?? []).map((p) => `${p.id}:${p.phase}:${p.leftMin ?? ""}`).join(",");
  useEffect(() => { if (items) onProgress?.(items); }, [progKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = () => { const v = !fold; setFold(v); try { localStorage.setItem(FOLD_KEY, v ? "1" : "0"); } catch { /* no storage */ } };
  const close = () => setClosed(true);
  if (closed) return null;

  return (
    <section className="glass home-desk" data-fold={fold || undefined} aria-labelledby="home-desk-title" data-tour="progress">
      <header className="flex items-center gap-2">
        <h2 id="home-desk-title" className="min-w-0 flex-1 truncate text-sm font-medium" role="status">{stopAll ? t("home.paused") : line}</h2>
        <button type="button" className={`chip shrink-0${needN ? " home-needs-on" : ""}`} onClick={onOpenNeeds} data-tour="needs">
          {t("needs.title")}{needN ? ` · ${badge(needN)}` : ""}
        </button>
        <button type="button" className="chip shrink-0" onClick={toggle} aria-expanded={!fold} aria-controls="home-desk-list" title={t(fold ? "home.show" : "home.hide")}><IconChevron style={{ transform: `rotate(${fold ? -90 : 90}deg)` }} /><span className="sr-only">{t(fold ? "home.show" : "home.hide")}</span></button>
        <button type="button" className="chip shrink-0" onClick={close} aria-label={t("common.close")} title={t("common.close")}><IconClose /></button>
      </header>
      {!fold && <div id="home-desk-list" className="mt-2">
        {failed && <p className="error text-sm" role="alert">{t("home.loadFailed")}</p>}
        {!failed && <ProgressList items={items} max={SHOWN} empty={t("home.empty")} onOpen={(p) => (p.id.startsWith("pilot:") ? openProgress(p.result?.open || p.action?.open || `#o=agents&k=goal&id=${encodeURIComponent(p.id.slice(6))}`) : onOpenTask(p.id))} />}
        <div className="mt-2"><RadarCards max={1} /></div>
        {items && items.length > SHOWN && <button type="button" className="link mt-1 text-xs" onClick={onOpenAll}>{t("home.all", { n: items.length })}</button>}
      </div>}
    </section>
  );
}
