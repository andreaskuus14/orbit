"use client";
// LIFE → Today: upcoming Google Calendar events (read-only). Not connected → a "Connect Google Calendar" link (full-page OAuth redirect).
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { eventDay, eventTime, type CalEvent } from "@/lib/gcal-pure";
import { useT } from "./i18n";
import { askConfirm } from "./ui/Dialog";

type CalState = { configured: boolean; connected: boolean; expired?: boolean; events?: CalEvent[]; error?: string; timetable?: { url: string | null } };
const dayLabel = (k: string) => new Date(`${k}T12:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

export default function CalendarCard() {
  const { t } = useT();
  const [s, setS] = useState<CalState | null>(null);
  const load = useCallback(() => fetch("/api/life/calendar").then((r) => r.json()).then(setS, () => setS(null)), []);
  useEffect(() => { void load(); }, [load]);
  const disconnect = async () => {
    if (!(await askConfirm(t("cal.disconnectAsk"), { ok: t("lf.cal.disconnect"), danger: true }))) return;
    await fetch("/api/life/calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "disconnect" }) }).catch(() => {});
    void load();
  };
  const [tErr, setTErr] = useState("");
  const post = async (body: object) => {
    const r = await fetch("/api/life/calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json(), () => ({ error: "Network error" }));
    setTErr(r.error ?? ""); void load();
  };
  const upload = async (f?: File) => { if (f) await post({ action: "timetable", text: await f.text() }); };
  const [link, setLink] = useState<string | null>(null); // null = field closed
  const addUrl = (e: FormEvent) => { e.preventDefault(); const u = link?.trim(); if (!u) return; setLink(null); void post({ action: "timetable", url: u }); };
  if (!s) return null;
  const events = (s.events ?? []).slice(0, 12);
  return (
    <div className="pu-card space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <b>{t("lf.cal.title")}</b>
        {s.timetable && <button className="pu-btn" data-variant="ghost" data-size="sm" onClick={() => void post({ action: "timetable-remove" })}>{t("cal.removeTt")}</button>}
        {s.connected && <button className="pu-btn" data-variant="ghost" data-size="sm" onClick={() => void disconnect()}>{t("lf.cal.disconnect")}</button>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="pu-btn cursor-pointer" data-variant="secondary" data-size="sm">{t("cal.import")}<input type="file" accept=".ics,text/calendar" className="sr-only" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} /></label>
        {link === null ? <button className="pu-btn" data-variant="secondary" data-size="sm" onClick={() => setLink("")}>{t("cal.fromLink")}</button> : (
          <form className="cal-link" onSubmit={addUrl}>
            <input autoFocus className="cal-link-input" type="text" inputMode="url" spellCheck={false} value={link} aria-label={t("cal.linkPrompt")} placeholder={t("cal.linkPrompt")}
              onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setLink(null); } }} />
            <button className="pu-btn" data-variant="primary" data-size="sm" type="submit" disabled={!link.trim()}>{t("common.add")}</button>
            <button className="pu-btn" data-variant="ghost" data-size="sm" type="button" onClick={() => setLink(null)}>{t("common.cancel")}</button>
          </form>
        )}
        {tErr && <span className="error" role="alert">{tErr}</span>}
      </div>
      {!s.connected && !events.length ? (
        s.expired ? <a className="error text-xs underline" href="/api/life/calendar/oauth">{t("morning.calExpired")}</a>
        : s.configured ? <a className="pu-btn inline-flex" data-variant="secondary" data-size="sm" href="/api/life/calendar/oauth">{t("lf.cal.connect")}</a>
          : <p className="muted text-xs">{t("lf.cal.notSetUp")}</p>
      ) : s.error && !events.length ? <p className="error text-xs" role="alert">{s.error}</p>
        : !events.length ? <p className="muted text-xs">{t("lf.cal.empty")}</p> : (
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
