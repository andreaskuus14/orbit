"use client";
import { useCallback, useEffect, useState } from "react";
import type { EpisodeView } from "@/lib/episodes-pure";
import { useT } from "./i18n";

// MEMORY → Episodes: the moments ORBIT remembers (calls, decisions, wins, setbacks, milestones). Data: /api/memories/episodes (episodes.ts).

const ICON: Record<EpisodeView["type"], string> = { call: "📞", decision: "⚖️", win: "🏆", failure: "🌧️", milestone: "🚩" };

export function EpisodesList({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useT();
  const [eps, setEps] = useState<EpisodeView[] | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => fetch("/api/memories/episodes", { cache: "no-store" }).then((r) => r.json())
    .then((j) => (j.error ? setMsg(j.error) : setEps(j.episodes))).catch((e) => setMsg(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  async function build() {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/memories/episodes", { method: "POST" }), j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      setMsg(j.added ? (j.added === 1 ? t("eps.new1") : t("eps.newN", { n: j.added })) : t("eps.nothing"));
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : t("eps.buildFail")); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="muted text-xs">{t("eps.help")}</p>
        <button type="button" className="chip shrink-0" disabled={busy} onClick={build}>{busy ? t("eps.building") : t("eps.build")}</button>
      </div>
      {msg && <p className="muted text-xs" role="status">{msg}</p>}
      <ul className="space-y-2">
        {(eps ?? []).map((e) => (
          <li key={e.id}>
            <button className="card w-full text-left" onClick={() => onOpen(e.id)}>
              <div className="font-medium"><span aria-hidden>{ICON[e.type]} </span>{e.what}</div>
              <div className="muted mt-1 text-[11px]">{e.type} · {e.when}{e.outcome ? ` · ${e.outcome}` : ""}</div>
              {e.feelings && <div className="muted mt-1 text-xs italic">{e.feelings}</div>}
            </button>
          </li>
        ))}
        {eps && !eps.length && <li className="muted">{t("eps.empty")}</li>}
        {!eps && !msg && <li className="muted">{t("eps.loading")}</li>}
      </ul>
    </div>
  );
}
