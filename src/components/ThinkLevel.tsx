"use client";
// Thinking level UI (think-level-pure.ts): one small picker by the composer (Auto / quick / normal / deep, for the next message)
// and one word on each answer saying how hard CORE thought, with why in its tooltip.
import { CHOICES, answerLevel, type LevelChoice } from "@/lib/think-level-pure";
import type { Key } from "@/lib/i18n-pure";
import { useT } from "./i18n";

export function LevelPicker({ value, onChange, disabled }: { value: LevelChoice; onChange: (v: LevelChoice) => void; disabled?: boolean }) {
  const { t } = useT();
  return (
    <select className="field level-pick py-1 text-xs" value={value} disabled={disabled} aria-label={t("level.label")} title={t("level.pickTitle")}
      onChange={(e) => onChange(e.target.value as LevelChoice)}>
      {CHOICES.map((c) => <option key={c} value={c}>{t(`level.${c}` as Key)}</option>)}
    </select>
  );
}

export function LevelWord({ trace, model, reviewed }: { trace?: { step: string; detail?: string }[]; model?: string; reviewed?: boolean }) {
  const { t } = useT();
  const l = answerLevel(trace, model);
  if (!l) return null;
  const word = t(`level.${l.level}` as Key);
  return <span className={`level-word ml-auto${l.capped ? " level-capped" : ""}`} data-testid="core-level"
    title={t("level.tip", { level: word, why: t(`level.why.${l.why}` as Key) }) + (l.level === "deep" && reviewed ? " ✓" : "")}>{t("level.used", { level: word })}</span>;
}
