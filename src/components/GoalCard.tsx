"use client";
// CORE's Goal card (goal-card-pure.ts): [Start] creates a mission via /api/missions, [Change…] focuses the chat box for a free-form
// correction (CORE revises the card), [Not now] hides it. Start never sends, spends or publishes.
import { useState } from "react";
import { goalMission, type GoalCard } from "@/lib/goal-card-pure";
import { getLang, useT } from "./i18n";

export function GoalCardView({ card, onChange }: { card: GoalCard; onChange: () => void }) {
  const { t } = useT();
  const [state, setState] = useState<"" | "starting" | "started" | "hidden" | string>("");
  if (state === "hidden") return null;
  const start = async () => {
    setState("starting");
    const r = await fetch("/api/missions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(goalMission(card, getLang())) })
      .then((x) => x.json()).catch(() => ({ error: t("gcard.failed") }));
    setState(r?.id ? "started" : String(r?.error ?? t("gcard.failed")));
  };
  const sec = (k: string, items?: string[]) => !!items?.length && (
    <div><div className="muted text-xs">{t(k as never)}</div><ul className="ml-4 list-disc">{items.map((x) => <li key={x}>{x}</li>)}</ul></div>);
  return (
    <section className="mt-2 space-y-1.5 rounded border border-white/10 p-2 text-sm" aria-label={t("gcard.title")}>
      <div className="font-semibold">{t("gcard.title")}: {card.objective}</div>
      {card.why && <div className="muted text-xs">{t("gcard.why")}: {card.why}</div>}
      {sec("gcard.deliverables", card.deliverables)}
      {sec("gcard.acceptance", card.acceptance)}
      {sec("gcard.assumptions", card.assumptions)}
      {sec("gcard.steps", card.steps)}
      <div className="muted text-xs">{t("gcard.effort")}: {card.effort} · {t("gcard.agent")}: {card.agent}</div>
      {sec("gcard.fromMemory", card.fromMemory)}
      {card.question && <div className="text-xs">{card.question}</div>}
      <div className="flex flex-wrap items-center gap-1.5" role="group">
        {state === "started" ? <span className="text-xs">{t("gcard.started")}</span> : <>
          <button type="button" className="chip" disabled={state === "starting"} onClick={() => void start()}>{t("gcard.start")}</button>
          <button type="button" className="chip" onClick={onChange}>{t("gcard.change")}</button>
          <button type="button" className="chip" onClick={() => setState("hidden")}>{t("ws.notNow")}</button>
          {state && state !== "starting" && <span role="alert" className="text-xs">{state}</span>}
        </>}
      </div>
      <p className="muted text-xs">{t("gcard.safe")}</p>
    </section>
  );
}
