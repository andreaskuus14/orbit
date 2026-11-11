"use client";
// Roadmap 34/37: one Work sheet, four names over the existing panels (reused as they are, not rewritten).
// Teams and chains keep their builder in AGENTS; their running tasks show under Work via ContinueWork.
import { useEffect, useState } from "react";
import { WORK_TABS, type WorkTab } from "@/lib/work-vocab-pure";
import { useT } from "./i18n";
import { ContinueWork } from "./ContinueWork";
import MissionsPanel from "./MissionsPanel";
import { RulesView } from "./RulesView";
import SkillsPanel from "./SkillsPanel";
import RecipesPanel from "./RecipesPanel";
import GoalsPanel from "./GoalsPanel";

type Roster = { slug: string; name: string; color: string }[];

export function WorkView({ tab, onTab, onOpenTask, onOpenGoal }: { tab: WorkTab; onTab: (t: WorkTab) => void; onOpenTask: (id: string) => void; onOpenGoal: (id: string) => void }) {
  const { lang } = useT();
  const [agents, setAgents] = useState<Roster>([]);
  useEffect(() => {
    if (tab !== "goals" || agents.length) return;
    fetch("/api/agents").then((r) => (r.ok ? r.json() : null)).then((j) => { if (Array.isArray(j?.agents)) setAgents(j.agents); }).catch(() => { /* GoalsPanel still lists goals */ });
  }, [tab, agents.length]);
  const move = (e: React.KeyboardEvent, i: number) => {
    const last = WORK_TABS.length - 1;
    let index: number;
    switch (e.key) {
      case "Home": index = 0; break;
      case "End": index = last; break;
      case "ArrowRight": index = i === last ? 0 : i + 1; break;
      case "ArrowLeft": index = i === 0 ? last : i - 1; break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
    const next = WORK_TABS[index].id;
    onTab(next);
    document.getElementById(`work-tab-${next}`)?.focus();
  };
  return (
    <>
      <div role="tablist" aria-label={lang === "et" ? "Töö" : "Work"} className="mb-3 flex flex-wrap gap-1.5">
        {WORK_TABS.map((w, i) => (
          <button key={w.id} id={`work-tab-${w.id}`} role="tab" aria-selected={tab === w.id} aria-controls="work-tabpanel" tabIndex={tab === w.id ? 0 : -1}
            className="chip" style={tab === w.id ? { borderColor: "var(--cyan)" } : undefined} onClick={() => onTab(w.id)} onKeyDown={(e) => move(e, i)}>
            {lang === "et" ? w.et : w.en}
          </button>
        ))}
      </div>
      <div id="work-tabpanel" role="tabpanel" tabIndex={0} aria-labelledby={`work-tab-${tab}`} className="space-y-4">
        {tab === "work" ? <><ContinueWork onOpenTask={onOpenTask} onOpenGoal={onOpenGoal} /><MissionsPanel visible onOpenTask={onOpenTask} /></>
          : tab === "routines" ? <RulesView onOpenTask={onOpenTask} />
          : tab === "workflows" ? <><SkillsPanel /><RecipesPanel onOpenTask={onOpenTask} /></>
          : <GoalsPanel agents={agents} visible onOpenTask={onOpenTask} />}
      </div>
    </>
  );
}
