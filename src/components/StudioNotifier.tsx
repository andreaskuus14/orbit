"use client";
// STUDIO desktop notifications: polls the clip factory (60 s visible, 5 min hidden), announces new ready clips, failed jobs,
// YouTube-blocked downloads and scheduled Shorts going live. Logic: src/lib/studio-notify.ts. Renders only the permission chip.
import { useEffect, useState } from "react";
import { sharedJson } from "./use-poll";
import { parseState, step, type NotifyState } from "@/lib/studio-notify";
import { notify } from "@/lib/notify-pure";
import { clipProblemNotices, RESOLVE_ALERT } from "@/lib/interruption-pure";
import { ACK_EVENT, alertSnapshot, alertingGroups } from "@/lib/clips/failure-alert-pure";

const KEY = "orbit.studioNotify";
const load = () => { try { return parseState(localStorage.getItem(KEY)); } catch { return parseState(null); } };
const save = (s: NotifyState) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable: may re-announce after a restart */ } };

// CORE suggestions join the shared bus even without desktop permission; first poll is a baseline.
const SEEN = "orbit.insightsSeen";
let insightsSeen: string[] | null = null;
async function insightNotes() {
  const j = await sharedJson<{ items?: { priority: string; key: string; kind: string; title: string; detail: string }[] }>("/api/insights");
  if (!j) return;
  const high = (j.items ?? []).filter((i: { priority: string }) => i.priority === "high") as { key: string; kind: string; title: string; detail: string }[];
  let seen = insightsSeen;
  try { const stored = JSON.parse(localStorage.getItem(SEEN) ?? "null"); if (Array.isArray(stored)) seen = stored; } catch { /* use session baseline */ }
  insightsSeen = [...new Set([...(seen ?? []), ...high.map((i) => i.key)])].slice(-200);
  try { localStorage.setItem(SEEN, JSON.stringify(insightsSeen)); } catch { /* session baseline still advances */ }
  if (!Array.isArray(seen)) return;
  for (const i of high.filter((i) => !seen!.includes(i.key))) {
    notify({ key: `insight:${i.key}`, title: `CORE suggests: ${i.title}`, body: i.detail, reason: `${i.title}. ${i.detail}`,
      signal: i.kind === "hot" ? "short-hot" : "routine", kind: "core", nav: { panel: "core" } });
  }
}

export function StudioNotifier() {
  const [ask, setAsk] = useState(false);
  useEffect(() => { setAsk("Notification" in window && Notification.permission === "default"); }, []);

  useEffect(() => {
    let timer = 0, stopped = false, last = 0, busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true; last = Date.now();
      try {
        const state = load(); // fresh each time, so another tab's announcements count as seen
        const snapshot = await sharedJson<Parameters<typeof step>[1] & { failAck?: string[] }>("/api/studio/clips");
        if (snapshot && !stopped) {
          const groups = alertingGroups(snapshot, snapshot.failAck ?? [], Date.now()); // last 72 h, not dismissed (server-side)
          // Job/download failures open the Failed list; upload failures keep their review link.
          const failures = clipProblemNotices(alertSnapshot(snapshot, groups)).map((n) => (n.nav?.view === "clips" ? { ...n, nav: { panel: "studio" as const, view: "failed" as const } } : n));
          failures.forEach(notify);
          if (!failures.length) dispatchEvent(new CustomEvent(RESOLVE_ALERT, { detail: "upload-failed" }));
          const res = step(state, snapshot, Date.now());
          save(res.state);
          res.notes.filter((n) => n.cat !== "failed").forEach((n) => notify({ title: n.title, body: n.body, reason: `${n.title}. ${n.body}`, kind: "studio",
            signal: "routine", nav: { panel: "studio", view: n.cat === "ready" ? "review" : "clips" } }));
        }
      } catch { /* offline / server restarting: next poll */ }
      await insightNotes().catch(() => {});
      busy = false;
      schedule();
    };
    // Due time counts from the last poll, so returning to the tab after >60 s polls at once rather than restarting the wait.
    const schedule = () => { clearTimeout(timer); if (!stopped && !busy && !document.hidden) timer = window.setTimeout(poll, Math.max(0, last + 60_000 - Date.now())); }; // hidden tab: none; the server keeps working
    void poll();
    const again = () => { last = 0; schedule(); }; // a dismissal in the Failed list: re-check now
    document.addEventListener("visibilitychange", schedule);
    addEventListener(ACK_EVENT, again);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", schedule); removeEventListener(ACK_EVENT, again); };
  }, []);

  if (!ask) return null;
  return <button className="chip hidden sm:inline-flex" title="Desktop alerts when clips are ready, a job fails or a Short goes live"
    onClick={() => void Notification.requestPermission().finally(() => setAsk(Notification.permission === "default"))}>🔔 Enable notifications</button>;
}
