"use client";
// One shared state line for workspaces (G04): loading, empty, partial, stale, offline, blocked, saving, saved, failed.
// Failed says what failed, what was kept, and offers one next action. Loading/saving time out into failed. Rules: lib/ui-state-pure.ts.
import { useEffect, useState, type ReactNode } from "react";
import { settle, SPIN_LIMIT_MS, type UiState } from "@/lib/ui-state-pure";
import { useT } from "./i18n";

export default function StateNote({ state, what, kept, action, limit = SPIN_LIMIT_MS, children }: {
  state: UiState; what?: string; kept?: string; action?: { label: string; run: () => void }; limit?: number; children?: ReactNode;
}) {
  const { t } = useT();
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  const spinning = state === "loading" || state === "saving";
  useEffect(() => { if (!spinning) return; const id = setTimeout(() => setNow(Date.now()), limit); return () => clearTimeout(id); }, [spinning, limit]);
  const s = settle(state, start, now, limit);
  const timedOut = s === "failed" && state !== "failed";
  const bad = s === "failed" || s === "offline" || s === "blocked";
  return (
    <div className={`state-note ${bad ? "error" : "muted"} text-sm`} role={bad ? "alert" : "status"} data-state={s}>
      <span>{children ?? (timedOut ? t("state.timeout") : t(`state.${s}`))}</span>
      {what && bad && <span> {t("state.what", { what })}</span>}
      {kept && <span className="muted"> {t("state.kept", { kept })}</span>}
      {action && (bad || s === "stale" || s === "partial") && <button className="chip ml-2" onClick={action.run}>{action.label}</button>}
    </div>
  );
}
