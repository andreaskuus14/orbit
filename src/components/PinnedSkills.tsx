"use client";

import { useEffect, useState } from "react";
import type { Skill } from "@/lib/skills-pure";
import { VOICE_ASK } from "./voice/bus";

const PIN_KEY = "orbit.mission.pinned-skills";

export function PinnedSkills({ onRun }: { onRun: () => void }) {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [pins, setPins] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [inputs, setInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(PIN_KEY) ?? "[]");
      if (Array.isArray(saved)) setPins(saved.filter((id): id is string => typeof id === "string"));
    } catch { /* Storage can be unavailable. */ }
  }, []);

  useEffect(() => {
    const request = new AbortController();
    fetch("/api/skills", { cache: "no-store", signal: request.signal }).then(async (r) => {
      if (!r.ok) throw new Error("Skills unavailable");
      const result = await r.json() as { skills?: Skill[] };
      if (!Array.isArray(result.skills)) throw new Error("Skills unavailable");
      if (!request.signal.aborted) setSkills(result.skills);
    }).catch(() => { if (!request.signal.aborted) setFailed(true); });
    return () => request.abort();
  }, [attempt]);

  const toggle = (id: string) => {
    const next = pins.includes(id) ? pins.filter((pin) => pin !== id) : [...pins, id];
    setPins(next);
    try { localStorage.setItem(PIN_KEY, JSON.stringify(next)); } catch { /* Pins still work in this session. */ }
  };

  if (failed) return <p role="alert">Couldn’t load saved skills. <button type="button" className="chip" onClick={() => { setFailed(false); setAttempt(attempt + 1); }}>Retry</button></p>;
  if (!skills) return <p role="status">Loading saved skills…</p>;
  if (!skills.length) return <p className="mc-dim">Keep a skill in Saved workflows to pin it here.</p>;
  const ordered = [...skills].sort((a, b) => Number(pins.includes(b.id)) - Number(pins.includes(a.id)));
  return <ul>{ordered.map((skill) => {
    const version = skill.versions.find((v) => v.v === skill.current);
    if (!version) return null;
    const pinned = pins.includes(skill.id);
    const input = inputs[skill.id] ?? "";
    const label = version.card?.inputs || "Optional skill input";
    return <li key={skill.id}>
      <div className="mc-row">
        <b>{version.name}</b>
        <button type="button" className="chip" aria-label={`Pin ${version.name}`} aria-pressed={pinned} onClick={() => toggle(skill.id)}>{pinned ? "Pinned" : "Pin"}</button>
      </div>
      {pinned && <form className="mc-actions" onSubmit={(e) => {
        e.preventDefault();
        const text = `run skill @${skill.id}${input.trim() ? `: ${input.trim()}` : ""}`;
        onRun();
        dispatchEvent(new CustomEvent(VOICE_ASK, { detail: { text } }));
      }}>
        <label>{label}<input className="field w-full" maxLength={2000} value={input} onChange={(e) => setInputs({ ...inputs, [skill.id]: e.target.value })} /></label>
        <button className="chip" type="submit">Run in CORE</button>
      </form>}
    </li>;
  })}</ul>;
}
