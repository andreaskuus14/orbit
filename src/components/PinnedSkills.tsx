"use client";

import { useEffect, useState } from "react";
import type { Skill } from "@/lib/skills-pure";
import { CORE_OPEN_SKILL_CHAT, queueSkillRun, useSkillReceipts } from "./skill-run-receipts";
import { ACTIVE_CHAT_KEY } from "@/lib/core-chats-pure";
import { skillRunLabel } from "@/lib/skill-run-pure";
import { NAV_EVENT, type NavTarget } from "@/lib/nav-pure";
import { VOICE_ASK } from "./voice/bus";

const PIN_KEY = "orbit.mission.pinned-skills";

export function PinnedSkills({ onRun, tasks }: { onRun: () => void; tasks?: unknown }) {
  const receipts = useSkillReceipts();
  const taskRows = (tasks as { tasks?: { id: string; status: string }[] } | null)?.tasks;
  const rows = Array.isArray(taskRows) ? taskRows : [];
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
    const receipt = receipts[skill.id];
    const task = receipt?.taskId ? rows.find((row) => row.id === receipt.taskId) : undefined;
    const status = skillRunLabel(receipt, task?.status);
    const openReceipt = () => {
      if (!receipt) return;
      onRun();
      if (receipt.taskId) {
        dispatchEvent(new CustomEvent<NavTarget>(NAV_EVENT, { detail: { panel: "operations", open: { kind: "task", id: receipt.taskId } } }));
      } else if (receipt.chatId) {
        try { localStorage.setItem(ACTIVE_CHAT_KEY, receipt.chatId); } catch { /* CORE can still be open already. */ }
        dispatchEvent(new CustomEvent<NavTarget>(NAV_EVENT, { detail: { panel: "core" } }));
        dispatchEvent(new CustomEvent(CORE_OPEN_SKILL_CHAT, { detail: receipt.chatId }));
      }
    };
    return <li key={skill.id}>
      <div className="mc-row">
        <b>{version.name}</b>
        <button type="button" className="chip" aria-label={`Pin ${version.name}`} aria-pressed={pinned} onClick={() => toggle(skill.id)}>{pinned ? "Pinned" : "Pin"}</button>
      </div>
      {pinned && status && <div className="mc-actions">
        <span role="status">{status}</span>
        {(receipt?.taskId || receipt?.chatId) && <button type="button" className="chip" onClick={openReceipt}>{receipt.taskId ? "Open task" : "Open CORE chat"}</button>}
      </div>}
      {pinned && <form className="mc-actions" onSubmit={(e) => {
        e.preventDefault();
        const text = `run skill @${skill.id}${input.trim() ? `: ${input.trim()}` : ""}`;
        const run = queueSkillRun(skill.id);
        onRun();
        dispatchEvent(new CustomEvent(VOICE_ASK, { detail: { text, skill: run } }));
      }}>
        <label>{label}<input className="field w-full" maxLength={2000} value={input} onChange={(e) => setInputs({ ...inputs, [skill.id]: e.target.value })} /></label>
        <button className="chip" type="submit">Run in CORE</button>
      </form>}
    </li>;
  })}</ul>;
}
