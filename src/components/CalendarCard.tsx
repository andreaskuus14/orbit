"use client";
// LIFE → Today: upcoming Google Calendar events (read-only). Not connected → a "Connect Google Calendar" link (full-page OAuth redirect).
import { useCallback, useEffect, useState } from "react";
import { eventDay, eventTime, type CalEvent } from "@/lib/gcal-pure";
import { useT } from "./i18n";

type CalState = { configured: boolean; connected: boolean; expired?: boolean; events?: CalEvent[]; error?: string };
const dayLabel = (k: string) => new Date(`${k}T12:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

export default function CalendarCard() {
  const { t } = useT();
  const [s, setS] = useState<CalState | null>(null);
  const load = useCallback(() => fetch("/api/life/calendar").then((r) => r.json()).then(setS, () => setS(null)), []);
  useEffect(() => { void load(); }, [load]);
  const disconnect = async () => {
    if (!confirm("Disconnect Google Calendar from ORBIT?")) return;
    await fetch("/api/life/calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "disconnect" }) }).catch(() => {});
    void load();
  };
  if (!s) return null;
  const events = (s.events ?? []).slice(0, 12);
  return (
    <div className="card space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <b>📅 Calendar</b>
        {s.connected && <button className="chip text-xs" onClick={() => void disconnect()}>Disconnect</button>}
      </div>
      {!s.connected ? (
        s.expired ? <a className="error text-xs underline" href="/api/life/calendar/oauth">📅 {t("morning.calExpired")}</a>
        : s.configured ? <a className="chip inline-block" href="/api/life/calendar/oauth">Connect Google Calendar</a>
          : <p className="muted text-xs">Connect Google Calendar: add GCAL_OAUTH_CLIENT_ID/_SECRET (or the YOUTUBE_OAUTH_ ones) to .env.local first.</p>
      ) : s.error ? <p className="error text-xs" role="alert">{s.error}</p>
        : !events.length ? <p className="muted text-xs">Nothing in the next 7 days.</p> : (
        <ul className="space-y-1">
          {events.map((e, k) => (
            <li key={k} className="flex gap-2">
              <span className="muted num w-28 shrink-0 text-xs">{dayLabel(eventDay(e))} {eventTime(e)}</span>
              <span className="flex-1">{e.title}{e.location && <span className="muted text-xs"> · {e.location}</span>}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
