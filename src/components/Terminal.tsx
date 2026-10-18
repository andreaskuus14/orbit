"use client";
// fsociety mode: ` (when not typing) or the palette opens a read-only hacker terminal over everything. Polls existing endpoints
// only while open; nothing typed here runs anything. Formatting: lib/terminal-pure.ts.
import { useEffect, useRef, useState } from "react";
import { activityLines, agentLines, appendNew, BANNER, busyLines, doctorLines, goalLines, statsLine, TERMINAL_EVENT, usageLines, type Line } from "@/lib/terminal-pure";

const get = (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json()).catch(() => null);

export function Terminal() {
  const ref = useRef<HTMLDialogElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [{ log, batch }, setLog] = useState<{ log: Line[]; batch: number }>({ log: [], batch: 0 }); // batch: where the newest lines start (typewriter stagger)
  const [stats, setStats] = useState("booting…");
  const last = useRef(new Map<string, string>());
  const logRef = useRef<Line[]>([]);
  const snap = useRef<{ usage?: unknown; agents?: unknown; doctor?: unknown }>({});

  useEffect(() => {
    const toggle = () => { const d = ref.current; if (!d) return; if (d.open) d.close(); else { d.showModal(); setOpen(true); } };
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "`" && e.code !== "Backquote") || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      e.preventDefault(); toggle();
    };
    addEventListener("keydown", onKey);
    addEventListener(TERMINAL_EVENT, toggle);
    return () => { removeEventListener("keydown", onKey); removeEventListener(TERMINAL_EVENT, toggle); };
  }, []);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const push = (lines: Line[]) => {
      if (!alive) return;
      const added = lines.filter((l) => last.current.get(l.id) !== l.body).length;
      const cur = logRef.current, next = appendNew(cur, last.current, lines); // outside the updater: appendNew mutates `last`
      if (next === cur) return;
      logRef.current = next;
      setLog({ log: next, batch: Math.max(0, next.length - added) });
    };
    const refresh = () => setStats(statsLine(performance.now(), snap.current.usage, snap.current.agents, snap.current.doctor));
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const poll = async (first: boolean) => {
      const [act, usage, agents, busy, doctor, goals] = await Promise.all([get("/api/activity"), get("/api/usage-meter"), get(`/api/agents/stats?tz=${encodeURIComponent(tz)}`), get("/api/studio/busy"),
        // the boot self-test is cached server-side; GET /api/goals also advances live goals, so both only on open
        first ? get("/api/doctor?boot=1") : null, first ? get("/api/goals") : null]);
      const now = Date.now();
      snap.current = { usage, agents, doctor: doctor ?? snap.current.doctor };
      push([...activityLines(act), ...usageLines(usage, now), ...agentLines(agents, now), ...busyLines(busy, now), ...doctorLines(doctor, now), ...goalLines(goals, now)]);
      if (alive) refresh();
    };
    void poll(true);
    const h = setInterval(() => { if (!document.hidden) void poll(false); }, 20_000), u = setInterval(refresh, 1000);
    return () => { alive = false; clearInterval(h); clearInterval(u); };
  }, [open]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [log]);

  return (
    <dialog ref={ref} className="fsoc" aria-label="fsociety terminal: live read-only feed" onClose={() => setOpen(false)}>
      <style>{`
.fsoc { position: fixed; inset: 0; width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 1rem; border: 0; background: #000; color: #4ade80; font: 13px/1.45 var(--font-mono, ui-monospace, monospace); overflow: hidden; }
.fsoc::backdrop { background: #000; }
.fsoc-scan { pointer-events: none; position: absolute; inset: 0; background: repeating-linear-gradient(transparent 0 2px, rgba(0,0,0,0.35) 2px 4px); animation: fsoc-scan 8s linear infinite; }
.fsoc-body { height: calc(100% - 2.5rem); overflow-y: auto; white-space: pre-wrap; word-break: break-word; }
.fsoc-banner { color: #fff; margin: 0 0 0.5rem; }
.fsoc-line { animation: fsoc-type 0.5s steps(30, end) both; }
.fsoc-cur { animation: fsoc-blink 1s steps(1) infinite; }
@keyframes fsoc-type { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
@keyframes fsoc-blink { 50% { opacity: 0; } }
@keyframes fsoc-scan { to { background-position: 0 100px; } }
@media (prefers-reduced-motion: reduce) { .fsoc-scan, .fsoc-line, .fsoc-cur { animation: none; } }
`}</style>
      <div className="fsoc-scan" aria-hidden="true" />
      <div className="flex items-center justify-between gap-3 text-white">
        <span>root@orbit:~# tail -f /var/log/orbit <span className="text-[#4ade80]">· {stats}</span></span>
        <button className="chip" onClick={() => ref.current?.close()} autoFocus aria-label="Close terminal (Esc or `)">exit</button>
      </div>
      <div className="fsoc-body mt-2" role="log" aria-live="off">
        <pre className="fsoc-banner" aria-hidden="true">{BANNER}</pre>
        {log.map((l, i) => (
          <div key={`${l.id}\n${l.text}`} className="fsoc-line" style={i >= batch ? { animationDelay: `${Math.min(i - batch, 40) * 60}ms` } : undefined}>
            {l.text}
          </div>
        ))}
        <div ref={bottom}>root@orbit:~# <span className="fsoc-cur" aria-hidden="true">█</span></div>
      </div>
    </dialog>
  );
}
