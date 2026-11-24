"use client";
// "Working on it" in the planet look: the shared Progress model (lib/progress-pure.ts, same data as ProgressCard) as one
// card: title, phase + time left, a thin bar, one live line, and at most one action. The action only opens where the exact
// item and its own Approve live; it never approves by itself (AGENTS.md rule 6).
import { doneShare, leftText, type Progress, type ProgressAction } from "@/lib/progress-pure";
import { useT } from "../i18n";
import { Button } from "./Button";
import { Card } from "./Card";

const TONE = { working: "accent", waiting: undefined, needs: "warn", done: "good", failed: "bad" } as const;

export function WorkCard({ p, onAction }: { p: Progress; onAction: (a: ProgressAction, p: Progress) => void }) {
  const { t, lang } = useT();
  const left = leftText(p.leftMin, lang);
  const share = doneShare(p);
  return (
    <Card as="li" tone={p.phase === "needs" ? "needs" : p.phase === "failed" ? "error" : undefined} label={`${p.title}: ${t(`prog.phase.${p.phase}`)}`}
      actions={p.action ? <Button size="sm" variant={p.action.kind === "approve" || p.action.kind === "pick" ? "primary" : "secondary"} onClick={() => onAction(p.action!, p)}>{p.action.label}</Button> : undefined}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span className="pu-dot" data-tone={TONE[p.phase]} data-live={p.phase === "working" ? "" : undefined} aria-hidden="true" />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span className="pu-row-title" style={{ display: "block" }}>{p.title}</span>
          <span className="pu-row-sub" style={{ display: "block" }}><span aria-live="polite">{t(`prog.phase.${p.phase}`)}</span>{left && ` · ${left}`}</span>
        </span>
      </div>
      {p.phase !== "done" && p.phase !== "failed" && <div className="pu-bar" role="progressbar" aria-label={p.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}><i style={{ ["--p" as string]: String(share) }} /></div>}
      {p.now && p.phase === "working" && <p className="pu-live" role="status" style={{ margin: 0 }}>{p.now}…</p>}
      {p.result && <p className="pu-live" style={{ margin: 0, color: p.phase === "failed" ? "var(--pu-bad)" : "var(--pu-ink-2)" }}>{p.result.text}</p>}
    </Card>
  );
}
