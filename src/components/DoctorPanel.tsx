"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Report, Status } from "@/lib/doctor-pure";
import type { BootResult } from "@/lib/doctor-boot-pure";
import { speakChunk, speechSettings, stop as stopSpeech } from "./voice/speak";

const COLOR: Record<Status, string> = { ok: "var(--mint)", warn: "var(--amber)", fail: "var(--rose)" };
const WORD: Record<Status, string> = { ok: "OK", warn: "CHECK", fail: "PROBLEM" };

/** ORBIT doctor: runs /api/doctor and lists each check with what to do. speak = read the result aloud (opened by voice/command). */
export function DoctorPanel({ onClose, speak }: { onClose: () => void; speak?: boolean }) {
  const [report, setReport] = useState<(Report & { boot?: BootResult | null }) | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const spoke = useRef(false);

  const run = useCallback(async () => {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/doctor", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) throw new Error("ORBIT couldn't confirm your sign-in. Either the database (Supabase) is unreachable or you were signed out. Check your internet, then reload the page and sign in.");
      if (!res.ok) throw new Error(`The check didn't run (error ${res.status}). Restart ORBIT and try again.`);
      const r = (await res.json()) as Report & { boot?: BootResult | null };
      setReport(r);
      if (speak && !spoke.current && speechSettings().speak) { spoke.current = true; speakChunk(r.speech); }
    } catch (e) {
      const m = e instanceof Error && e.message !== "Failed to fetch" ? e.message : "ORBIT's server isn't answering. Start ORBIT from the desktop shortcut.";
      setErr(m);
      if (speak && !spoke.current && speechSettings().speak) { spoke.current = true; speakChunk(m); }
    } finally { setBusy(false); }
  }, [speak]);
  useEffect(() => { void run(); }, [run]);
  useEffect(() => () => stopSpeech(), []); // closing the panel stops the read-out

  return (
    <aside className="glass drawer" style={{ zIndex: 40 }} role="dialog" aria-label="ORBIT doctor">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="brand text-base">🩺 ORBIT doctor</h2>
        <div className="flex gap-2">
          <button className="chip" onClick={run} disabled={busy}>{busy ? "Checking…" : "Check again"}</button>
          <button className="chip" onClick={onClose} aria-label="Close ORBIT doctor">Close</button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        {err ? <p className="error" role="alert">{err}</p>
          : !report ? <p className="muted text-sm">Checking everything (takes up to 10 seconds)…</p>
          : <>
            <p className="mb-3 text-sm" style={{ color: COLOR[report.status] }}><b>{report.headline}</b></p>
            <ul className="grid gap-2">
              {report.checks.map((c) => (
                <li key={c.id} className="rounded-lg border border-white/10 p-2 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <b>{c.label}</b>
                    <span className="shrink-0 font-mono text-[10px] tracking-widest" style={{ color: COLOR[c.status] }}>{WORD[c.status]}</span>
                  </div>
                  <p className="muted text-xs">{c.detail}</p>
                  {c.fix && c.status !== "ok" && <p className="mt-1 text-xs"><b>What to do:</b> {c.fix}</p>}
                  {c.fix && c.status === "ok" && <p className="muted mt-1 text-[11px]">{c.fix}</p>}
                </li>
              ))}
            </ul>
            {report.boot && <section className="mt-4 rounded-lg border border-white/10 p-2 text-sm" aria-label="Last self-test">
              <div className="flex items-baseline justify-between gap-2">
                <b>Last self-test</b>
                <span className="shrink-0 font-mono text-[10px] tracking-widest" style={{ color: COLOR[report.boot.report.status] }}>{WORD[report.boot.report.status]}</span>
              </div>
              <p className="muted text-xs">After the restart at {new Date(report.boot.bootId).toLocaleString()}: {report.boot.report.headline}</p>
              {report.boot.scan.crashes.length || report.boot.scan.exits.length ? <>
                <p className="mt-2 text-xs"><b>Crashes since the boot before{report.boot.scan.exits.length ? ` (${report.boot.scan.exits.join(", ")})` : ""}:</b></p>
                <ul className="mt-1 grid gap-1">
                  {report.boot.scan.crashes.map((c) => <li key={c.id} className="text-xs">{c.what}. <span className="muted">{c.fix}</span></li>)}
                  {!report.boot.scan.crashes.length && <li className="muted text-xs">Cause not recognised. Ask Claude Code to look at orbit-server.log.</li>}
                </ul>
              </> : <p className="muted mt-1 text-xs">No crashes since the boot before.</p>}
            </section>}
            <p className="muted mt-3 text-[10px]">Checked in {(report.ms / 1000).toFixed(1)} s · {new Date(report.at).toLocaleTimeString()}</p>
          </>}
      </div>
    </aside>
  );
}
