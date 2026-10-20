"use client";
import type { WorkItem, WorkSummary } from "@/lib/work-continuation-pure";

/** Same owner-scoped, read-only work list as the home screen; no extra browser fetch. */
export function MorningWork({ work, onOpen }: { work: WorkSummary; onOpen: (item: WorkItem) => void }) {
  return <div className="morning-work">
    <h3>Work to pick up</h3>
    {work.problems.map((problem) => <p key={problem} className="warn">{problem}</p>)}
    {work.items.length ? <ul>{work.items.slice(0, 3).map((item) => <li key={`${item.kind}:${item.id}`}>
      <button type="button" onClick={() => onOpen(item)} aria-label={`${item.action}: ${item.title}`}>
        <b>{item.title}</b><span className="muted">{item.detail}</span><span className="morning-work-action">{item.action} →</span>
      </button>
    </li>)}</ul> : !work.problems.length && <p className="muted">No unfinished tasks or goals in your work list.</p>}
    {work.items.length + work.more > 3 && <p className="muted text-xs">{work.items.length + work.more - 3} more in Continue my work.</p>}
  </div>;
}
