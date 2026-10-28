"use client";
import { useState } from "react";
import { useT } from "./i18n";
import type { Bug, DevWorld as World, FixState, Trail } from "@/lib/devworld-pure";
import type { DevSession } from "@/lib/dev-session-pure";
import { setVersion, suggestSessions, trailSteps, trailText } from "@/lib/dev-trail-pure";

// GAME DEV backlog item → Trail (roadmap 39): sessions, proposed fix, test evidence, shipped version. Stored in the dev world (trails).
// ORBIT never edits the place: a fix is only proposed/reviewed/rejected; the version is what Andreas records after shipping it himself.
export default function DevTrail({ bug, world, commit }: { bug: Bug; world: World; commit: (w: World) => boolean }) {
  const { lang } = useT(), x = trailText(lang);
  const [sessions, setSessions] = useState<DevSession[] | null>(null);
  const [fix, setFix] = useState("");
  const [ver, setVer] = useState("");
  const trail: Trail = world.trails?.find((t) => t.bugId === bug.id) ?? { bugId: bug.id, sessionIds: [] };
  const put = (t: Trail) => commit({ ...world, trails: [...(world.trails ?? []).filter((y) => y.bugId !== bug.id), t] });
  const open = () => fetch("/api/devsession", { cache: "no-store" }).then((r) => r.json()).then((j) => setSessions(j.sessions ?? []), () => setSessions([]));
  const setState = (state: FixState) => trail.fix && put({ ...trail, fix: { ...trail.fix, state }, ...(state !== "reviewed" && { version: undefined }) });

  if (!sessions) return <button className="chip" onClick={() => void open()}>{x.trail}</button>;
  const { steps, next } = trailSteps(bug, trail, sessions, lang);
  const sugg = suggestSessions(bug, sessions).filter((id) => !trail.sessionIds.includes(id));
  return (
    <div className="mt-1 w-full rounded-md border p-2 text-xs" aria-label={`${x.trail}: ${bug.title}`}>
      <ol className="grid gap-0.5">{steps.map((s, i) => <li key={i} style={{ color: s.ok === false ? "var(--rose, #f43f5e)" : undefined }}>{new Date(s.at).toLocaleDateString()} · {s.text}</li>)}</ol>
      {next && <p className="mt-1" role="status"><b>{next}</b></p>}
      {sugg.length > 0 && <p className="mt-1">{x.suggested}: {sugg.map((id) => {
        const s = sessions.find((y) => y.id === id)!;
        return <button key={id} className="chip ml-1" onClick={() => put({ ...trail, sessionIds: [...trail.sessionIds, id].slice(0, 20) })}>{x.link} #{s.n}</button>;
      })}</p>}
      {(!trail.fix || trail.fix.state === "rejected") && <div className="mt-1 flex gap-1">
        <input className="field flex-1 py-1" maxLength={2000} value={fix} onChange={(e) => setFix(e.target.value)} placeholder={x.fixPh} aria-label={x.fixPh} />
        <button className="chip" disabled={!fix.trim()} onClick={() => { if (put({ ...trail, fix: { text: fix.trim(), state: "proposed", at: new Date().toISOString() }, version: undefined })) setFix(""); }}>{x.saveFix}</button>
      </div>}
      {trail.fix?.state === "proposed" && <div className="mt-1 flex gap-1">
        <button className="chip" onClick={() => setState("reviewed")}>{x.markReviewed}</button>
        <button className="chip" onClick={() => setState("rejected")}>{x.reject}</button>
      </div>}
      {trail.fix?.state === "reviewed" && !trail.version && <div className="mt-1 flex gap-1">
        <input className="field flex-1 py-1" maxLength={40} value={ver} onChange={(e) => setVer(e.target.value)} placeholder={x.versionPh} aria-label={x.versionPh} />
        <button className="chip" disabled={!ver.trim()} onClick={() => { const t = setVersion(trail, ver, new Date().toISOString()); if (t && put(t)) setVer(""); }}>{x.setV}</button>
      </div>}
    </div>
  );
}
