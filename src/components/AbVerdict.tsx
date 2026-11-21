"use client";
// The one plain line of an honest A/B test (lib/abtest-pure.ts): too early (needs ~N more) / X is better (sure enough) / no real difference.
import type { Verdict } from "@/lib/abtest-pure";
import { useT } from "./i18n";

export function AbVerdict({ verdict, more, a, b, className }: { verdict: Verdict; more?: number; a: string; b: string; className?: string }) {
  const { t } = useT();
  const text = verdict === "better" ? t("ab.better", { b }) : verdict === "worse" ? t("ab.better", { b: a }) : verdict === "same" ? t("ab.same")
    : more !== undefined && Number.isFinite(more) ? t("ab.early", { n: Math.max(1, more) }) : t("ab.earlyMany");
  return <span className={className}>{text}</span>;
}
