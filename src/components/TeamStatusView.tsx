"use client";
// Mission Control v1 (OPERATIONS → Team): the agent team's handoff board as Done / Working / Blocked / Needs you, so what shipped,
// who's blocked and what needs Andreas's decision fit on one screen. Read-only; links open the PR or test run. Data:
// /api/team-status (the live board, or the labelled sample when the board can't be read). Grouping rules: lib/team-status-pure.ts.
import { useCallback, useState } from "react";
import { usePoll } from "./use-poll";
import { pollMs } from "@/lib/poll-pure";
import { SECTIONS, type Section, type TeamBoard, type TeamItem } from "@/lib/team-status-pure";
import { useT } from "./i18n";

type Data = { live: boolean; at?: string; reason?: string; board: TeamBoard };
const ACCENT: Partial<Record<Section, string>> = { needs: "#fbbf24", blocked: "var(--rose)" };
const PROOF_CLASS: Record<string, string> = { deployed: "pill ok", merged: "pill ok", passed: "pill", failed: "pill bad" };
// On a phone (one column) the decisions come first, so they're on screen without scrolling; wider screens keep Done → Needs you.
const PHONE_ORDER: Record<Section, string> = { needs: "max-sm:order-1", blocked: "max-sm:order-2", working: "max-sm:order-3", done: "max-sm:order-4" };

function Item({ it }: { it: TeamItem }) {
  const { t } = useT();
  const extra = it.section === "needs" && it.next ? t("team.next", { next: it.next }) : it.section === "blocked" && it.blocker ? t("team.blockedBy", { why: it.blocker }) : "";
  return (
    <li className="card space-y-1 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-xs" style={{ color: "var(--cyan)" }}>{it.agent === "C" ? t("team.coordinator") : t("team.agent", { n: it.agent })}</span>
        {it.proof && <span className={PROOF_CLASS[it.proof]} style={{ display: "inline-flex" }}>{t(`team.proof.${it.proof}`)}</span>}
        {it.link && <a className="link text-xs" href={it.link.href} target="_blank" rel="noopener noreferrer">{it.link.label}</a>}
        {it.updates > 1 && <span className="muted text-xs">· {t("team.updates", { n: it.updates })}</span>}
      </div>
      <p>{it.summary}</p>
      {extra && <p className="muted text-xs">{extra}</p>}
    </li>
  );
}

export function TeamStatusView() {
  const { t } = useT();
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState(false);
  const load = useCallback((refresh = false) => {
    fetch(`/api/team-status${refresh ? "?refresh=1" : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Data) => { setData(d); setErr(false); }, () => setErr(true));
  }, []);
  const poll = useCallback(() => load(), [load]);
  usePoll(poll, pollMs(60_000));

  return (
    <section className="space-y-3" aria-labelledby="team-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="team-title" className="h3">{t("team.title")}</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {data && (data.live
            ? <span className="pill ok" style={{ display: "inline-flex" }}>{t("team.live", { time: data.at ? new Date(data.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "" })}</span>
            : <span className="pill bad" role="status" style={{ display: "inline-flex" }}>{t("team.sample", { why: data.reason ?? "" })}</span>)}
          <button type="button" className="chip" onClick={() => load(true)}>{t("team.refresh")}</button>
        </div>
      </div>
      {err && <p className="error">{t("team.loadError")}</p>}
      {data && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {SECTIONS.map((s) => (
            <section key={s} aria-label={t(`team.${s}`)} className={`space-y-2 ${PHONE_ORDER[s]}`}>
              <h4 className="text-xs uppercase tracking-wider" style={{ color: ACCENT[s] ?? "var(--muted)" }}>{t(`team.${s}`)} · {data.board[s].length}</h4>
              {data.board[s].length
                ? <ul className="space-y-2" style={ACCENT[s] ? { borderLeft: `2px solid ${ACCENT[s]}`, paddingLeft: "0.5rem" } : undefined}>{data.board[s].map((it) => <Item key={`${it.agent}:${it.pr ?? "-"}`} it={it} />)}</ul>
                : <p className="muted text-xs">{t("team.none")}</p>}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
