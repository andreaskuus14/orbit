// Recording + measuring stage for feat/ui-motion (bundled by scripts/ui-motion-check.mjs; never part of the app build).
// The real Galaxy, CORE orb, streaming pieces, shared progress card and focused view, on a scripted request with invented
// data: no Supabase, no network, no model. ?motion=0 shows the old look (data-motion="off") for the before shots.
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Galaxy from "@/components/Galaxy";
import { CorePresence } from "@/components/motion/CorePresence";
import { FocusWork } from "@/components/motion/FocusWork";
import { HomeDepth } from "@/components/motion/HomeDepth";
import { useFollowWork } from "@/components/motion/useFollowWork";
import { corePhase } from "@/components/motion/motion";
import { createPacer, useStreamFade } from "@/components/motion/stream";
import { ChatAnswer } from "@/components/ChatAnswer";
import { ProgressCard } from "@/components/ProgressCard";
import { CoreActivity } from "@/components/CoreActivity";
import { fromStages, type Progress } from "@/lib/progress-pure";
import { followPlanet } from "@/lib/follow-pure";

const q = new URLSearchParams(location.search);
const MOTION = q.get("motion") !== "0";
document.documentElement.dataset.motion = MOTION ? "on" : "off";
const SPEED = Number(q.get("speed") || 1);
const GALAXY = q.get("galaxy") !== "0"; // galaxy=0: measure the UI layer alone (software WebGL would drown it)

const REPLY = "On it. I'll take your **last video**, find the 3 strongest moments and cut them into Shorts with captions. Nothing gets posted until you say so.";
const STAGES = ["Finding your last video", "Picking the best moments", "Cutting 3 Shorts", "Adding captions", "Checking the result"];
const JOB = { id: "job-shorts", title: "Make 3 Shorts from my last video", agent: "nova", request: "youtube shorts from my last video" };
const STEP_MS = 2300 / SPEED;

type W = Window & { __stage?: { phase: string; job: string | null; done: boolean }; __streamStart?: number; __streamEnd?: number; __type?: (t: string) => void; __back?: () => void };

function Reply({ text, done }: { text: string; done: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useStreamFade(ref, text, !done);
  return <div ref={ref} className="contents"><ChatAnswer text={text} streaming={!done} /></div>;
}

function Stage() {
  const shell = useRef<HTMLElement>(null);
  const pulses = useRef<Record<string, number>>({});
  const [cmd, setCmd] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [oldSel, setOldSel] = useState<ReturnType<typeof followPlanet> | null>(null); // motion off: the old camera flight, for the before numbers
  const [reply, setReply] = useState<string | null>(null);
  const [replyDone, setReplyDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStageN] = useState(-2); // -2: no job · -1: queued · 0..n-1 running · n done
  const [startedAt, setStartedAt] = useState(0);
  const fw = useFollowWork({ enabled: MOTION, onHome: true, canFly: true, leave: () => {} });
  const at = useMemo(() => Date.now(), [stage]); // eslint-disable-line react-hooks/exhaustive-deps
  const p: Progress | null = stage < -1 ? null : fromStages({
    id: JOB.id, title: JOB.title, stages: STAGES, current: stage, startedAt: null, typicalMs: STEP_MS * STAGES.length,
    now: stage >= 0 && stage < STAGES.length ? STAGES[stage] : null, at: new Date(startedAt || Date.now()).toISOString(),
    result: stage >= STAGES.length ? { text: "3 Shorts are ready in STUDIO. Nothing is posted.", open: "#o=studio" } : null,
  }, "en", Date.now());
  const pp = p && p.phase === "working" ? { ...p, leftMin: ((STAGES.length - stage) * STEP_MS) / 60_000 } : p;

  useEffect(() => { // typing on the page's own clock, so a frame-by-frame recording types at a natural pace
    (window as W).__type = (t: string) => { input.current?.focus(); let i = 0; const tick = () => { i++; setCmd(t.slice(0, i)); if (i < t.length) setTimeout(tick, 42 + (i % 5) * 9); else setTimeout(() => form.current?.requestSubmit(), 380); }; tick(); };
    (window as W).__back = () => fw.back();
  });
  useEffect(() => { (window as W).__stage = { phase: "idle", job: fw.job?.id ?? null, done: stage >= STAGES.length }; }, [fw.job, stage]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!cmd.trim() || busy) return;
    setCmd(""); setBusy(true); setReply(null); setReplyDone(false);
    fw.markRequest();
    corePhase({ type: "submit" });
    const T = (ms: number, f: () => void) => setTimeout(f, ms / SPEED);
    T(900, () => corePhase({ type: "tool", tool: "search_memory" }));
    T(1700, () => corePhase({ type: "tool", tool: "web_search" }));
    T(2500, () => {
      // The reply arrives in uneven network bursts; the pacer spreads them (motion on) or shows each burst at once (off).
      const pacer = createPacer((t) => setReply(t), MOTION);
      let n = 0;
      (window as W).__streamStart = performance.now();
      const burst = () => {
        n = Math.min(REPLY.length, n + 14 + Math.round(Math.random() * 30));
        pacer.push(REPLY.slice(0, n));
        corePhase({ type: "delta" });
        if (n < REPLY.length) setTimeout(burst, (90 + Math.random() * 160) / SPEED);
        else setTimeout(() => { pacer.flush(); setReply(REPLY); setReplyDone(true); corePhase({ type: "done" }); (window as W).__streamEnd = performance.now(); }, 320 / SPEED);
      };
      burst();
    });
    T(4700, () => {
      setStageN(-1); setStartedAt(Date.now()); setBusy(false);
      if (MOTION) fw.offer({ id: JOB.id, title: JOB.title, planet: followPlanet(JOB) }, true);
      else setOldSel(followPlanet(JOB));
      for (let i = 0; i <= STAGES.length; i++) setTimeout(() => setStageN(i), (900 + i * STEP_MS) / SPEED);
    });
  };
  useEffect(() => { if (fw.job === null && stage >= STAGES.length && MOTION) setReply(null); }, [fw.job, stage]);

  return (
    <main ref={shell} className="orbit-shell relative h-dvh w-full overflow-hidden" data-view="3d">
      <div className="galaxy-layer absolute inset-0">
        {GALAXY && <Galaxy selected={fw.cam ?? oldSel} followFly={!!fw.cam} onSelect={() => {}} memoryCount={24} pulses={pulses} busy={busy} warning={false} pulseBusy={false} pulseFailed={false}
          agentsWorking={stage >= 0 && stage < STAGES.length ? 1 : 0} automationFailing={false} reduced={false} panelOpen={!!fw.job} quality={(q.get("quality") as "auto" | "low" | "high" | null) ?? "auto"} />}
      </div>
      {MOTION && <HomeDepth shell={shell} dim={!!fw.job} />}
      <header className="absolute inset-x-0 top-0 flex items-center px-4 py-3"><span className="brand">Orbital</span></header>
      {p && !fw.job && (
        <section className="glass home-desk" aria-label="Working on it">
          <h2 className="truncate text-sm font-medium">{p.phase === "done" ? "1 done today" : "Working on 1 thing"}</h2>
          <div className="mt-2"><ProgressCard p={pp!} onOpen={() => MOTION && fw.open({ id: JOB.id, title: JOB.title, planet: followPlanet(JOB) })} /></div>
        </section>
      )}
      {reply !== null && !fw.job && (
        <section className="glass absolute bottom-[9.5rem] left-1/2 z-[31] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl p-4 text-sm" aria-label="CORE">
          <Reply text={reply} done={replyDone} />
        </section>
      )}
      {!MOTION && busy && reply === null && (
        <section className="glass absolute bottom-[9.5rem] left-1/2 z-[31] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl p-4 text-sm">
          <CoreActivity rows={[{ id: 1, label: "Searching memory…", at: 0, tool: "search_memory" } as never]} running since={Date.now() - 900} />
        </section>
      )}
      {MOTION && !fw.job && reply === null && <CorePresence size="lg" hideIdle className="home-presence" />}
      {MOTION && !fw.job && reply !== null && !replyDone && <div className="absolute bottom-[15.5rem] left-1/2 z-[31] -translate-x-1/2"><CorePresence /></div>}
      {MOTION && fw.job && fw.sheet && <FocusWork p={pp} planet={fw.job.planet} at={at} onBack={fw.back} follow={fw.follow} onFollow={fw.setFollow} leaving={fw.leaving} />}
      <form ref={form} onSubmit={submit} className="glass cmdbar" data-home="">
        <div className="flex gap-2">
          <input ref={input} className="field w-full" value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="Tell ORBIT what you need" aria-label="Tell ORBIT what you need" />
        </div>
      </form>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Stage />);
