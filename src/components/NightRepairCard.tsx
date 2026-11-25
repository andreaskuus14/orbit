"use client";
import { useCallback, useEffect, useState } from "react";
import { useT } from "./i18n";
import type { Key } from "@/lib/i18n-core-pure";
import type { repairView } from "@/lib/night-repair";
import { askConfirm } from "./ui/Dialog";

type View = Awaited<ReturnType<typeof repairView>>;
const COLOR: Record<string, string> = { waiting: "var(--amber)", merged: "var(--mint)", rejected: "var(--muted, #999)", failed: "var(--rose)", discarded: "var(--muted, #999)" };

/** DEV → Doctor: night repair. Patches ORBIT prepared overnight (problem, diff, gate, measured effect); Approve / Reject per patch. */
export function NightRepairCard() {
  const { t } = useT();
  const [v, setV] = useState<View | null>(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const load = useCallback(() => { void fetch("/api/night-repair").then((r) => (r.ok ? r.json() : null)).then((j) => j && setV(j as View)).catch(() => {}); }, []);
  useEffect(load, [load]);
  const decide = async (id: string, seen: string, action: "approve" | "reject") => {
    if (action === "approve" && !(await askConfirm(t("repair.confirm")))) return;
    setBusy(id); setNote("");
    const r = await fetch("/api/night-repair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, id, seen }) })
      .then((x) => x.json() as Promise<{ message?: string; error?: string; view?: View }>).catch(() => ({ error: "Network error" }) as { error: string; view?: View });
    setBusy(""); setNote(r.error ?? ("message" in r ? r.message ?? "" : ""));
    if (r.view) setV(r.view); else load();
  };
  if (!v) return null;
  const last = v.nights[0];
  return (
    <section className="mt-4 rounded-lg border border-white/10 p-2 text-sm" aria-label={t("repair.title")}>
      <b>{t("repair.title")}</b>
      <p className="muted text-xs">{t("repair.next")} {v.running ? "…" : v.next}</p>
      {last?.selftest && <p className="muted text-xs">{t("repair.lastNight", { tests: last.selftest.tests.ok ? t("repair.testsOk") : t("repair.testsFail", { n: last.selftest.tests.failed }), calls: last.calls })}</p>}
      {!v.patches.length && <p className="muted text-xs">{t("repair.none")}</p>}
      <ul className="mt-1 space-y-2">
        {v.patches.map((p) => (
          <li key={p.id} className="rounded border border-white/10 p-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">{p.title}</span>
              <span className="text-xs" style={{ color: COLOR[p.status] }}>{t(`repair.status.${p.status}` as Key)}</span>
            </div>
            <div className="muted text-xs">{p.branch} · {p.pr ? <a className="underline" href={p.pr.url} target="_blank" rel="noreferrer">{t("repair.pr")} #{p.pr.number}</a> : t("repair.local")}</div>
            <pre className="mt-1 whitespace-pre-wrap text-xs" style={{ fontFamily: "inherit" }}>{p.card.message}</pre>
            {p.reason && p.status !== "waiting" && <p className="muted text-xs">{p.reason}</p>}
            {p.status === "waiting" && p.gate?.ok && (
              <div className="mt-1 flex gap-2">
                <button className="btn" disabled={!!busy} onClick={() => void decide(p.id, p.seen, "approve")}>{busy === p.id ? "…" : t("repair.approve")}</button>
                <button className="chip" disabled={!!busy} onClick={() => void decide(p.id, p.seen, "reject")}>{t("repair.reject")}</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {note && <p className="mt-1 text-xs" role="status">{note}</p>}
    </section>
  );
}
