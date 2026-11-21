"use client";
// "Working on it" card: the one way ORBIT shows progress, everywhere (home, Needs you, phone, every planet). Model and builders:
// lib/progress-pure.ts. One request = one card: plain steps (✓ ● ○), "about X min left", one live line, the result, and at most one
// button. The button only opens where the exact item and its own Approve live; it never approves by itself (AGENTS.md rule 6).
import { useState } from "react";
import { doneShare, leftText, type Progress, type ProgressAction } from "@/lib/progress-pure";
import { useT } from "./i18n";

const MARK = { done: "✓", now: "●", next: "○", failed: "✕" } as const;
const TONE = { working: "var(--cyan)", waiting: "var(--muted)", needs: "#fbbf24", done: "#6ee7b7", failed: "#fb7185" } as const;

/** Follow a card's link: an in-app deep link (#o=…) or a page. */
export function openProgress(open: string) {
  if (!open) return;
  if (open.startsWith("#")) location.hash = open.slice(1);
  else window.open(open, "_blank", "noopener");
}

export function ProgressCard({ p, onAction, onOpen, compact = false }: {
  p: Progress;
  onAction?: (a: ProgressAction, p: Progress) => void; // default: openProgress(a.open)
  onOpen?: (p: Progress) => void;                     // title click; default: the result's / action's link, if any
  compact?: boolean;                                  // compact: only the step before, the current step and the next one
}) {
  const { t, lang } = useT();
  const [all, setAll] = useState(false);
  const cur = Math.max(0, p.steps.findIndex((s) => s.state === "now" || s.state === "failed"));
  const steps = compact && !all && p.steps.length > 3 ? p.steps.slice(Math.max(0, Math.min(cur - 1, p.steps.length - 3)), Math.max(0, Math.min(cur - 1, p.steps.length - 3)) + 3) : p.steps;
  const hidden = p.steps.length - steps.length;
  const link = p.result?.open || p.action?.open || "";
  const left = leftText(p.leftMin, lang);
  return (
    <article className="card progress-card space-y-1.5" data-phase={p.phase} aria-label={`${p.title}: ${t(`prog.phase.${p.phase}`)}`}>
      <header className="flex items-start gap-2">
        <span className="progress-dot mt-1.5" style={{ background: TONE[p.phase] }} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          {onOpen || link ? <button type="button" className="block w-full truncate text-left font-medium hover:underline" onClick={() => (onOpen ? onOpen(p) : openProgress(link))}>{p.title}</button>
            : <b className="block truncate font-medium">{p.title}</b>}
          <small className="muted">{t(`prog.phase.${p.phase}`)}{left && ` · ${left}`}</small>
        </span>
        {p.action && <button type="button" className={p.action.kind === "approve" || p.action.kind === "pick" ? "btn shrink-0 px-3 py-1 text-xs" : "chip shrink-0"}
          onClick={() => (onAction ? onAction(p.action!, p) : openProgress(p.action!.open))}>{p.action.label}</button>}
      </header>
      {p.phase !== "done" && <div className="progress-bar" aria-hidden="true"><i style={{ width: `${Math.round(doneShare(p) * 100)}%`, background: TONE[p.phase] }} /></div>}
      {p.now && <p className="progress-now text-sm" role="status">{p.now}…</p>}
      {steps.length > 1 && (
        <ol className="progress-steps text-xs" aria-label={t("prog.steps")}>
          {steps.map((s, i) => <li key={i} data-state={s.state}><span aria-hidden="true">{MARK[s.state]}</span> {s.label}<span className="sr-only"> ({t(`prog.step.${s.state}`)})</span></li>)}
          {hidden > 0 && <li><button type="button" className="link" onClick={() => setAll(true)}>{t("prog.allSteps", { n: p.steps.length })}</button></li>}
        </ol>
      )}
      {p.result && <p className={`text-sm${p.phase === "failed" ? " error" : ""}`}>{p.phase === "done" ? "→ " : ""}{p.result.text}</p>}
    </article>
  );
}

/** A list of cards with a plain empty state that says what to do next. */
export function ProgressList({ items, empty, compact = true, max, onAction, onOpen }: {
  items: Progress[] | null; empty?: string; compact?: boolean; max?: number;
  onAction?: (a: ProgressAction, p: Progress) => void; onOpen?: (p: Progress) => void;
}) {
  const { t } = useT();
  if (!items) return <p className="muted text-sm" role="status">{t("common.loading")}</p>;
  if (!items.length) return <p className="muted text-sm">{empty ?? t("prog.empty")}</p>;
  return <ul className="space-y-2">{items.slice(0, max ?? items.length).map((p) => <li key={p.id}><ProgressCard p={p} compact={compact} onAction={onAction} onOpen={onOpen} /></li>)}</ul>;
}
