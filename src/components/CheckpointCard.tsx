"use client";
// The open chat's work checkpoint (checkpoint-pure.ts) in the CORE chat sheet: what CORE always keeps in mind; edit or delete lines.
import { useCallback, useEffect, useState } from "react";
import { MAX_TEXT, type CpKind, type CpLine } from "@/lib/checkpoint-pure";
import { askConfirm, askText } from "./ui/Dialog";
import { useT } from "./i18n";


export function CheckpointCard({ chatId }: { chatId: string | null }) {
  const { t } = useT();
  const [lines, setLines] = useState<CpLine[]>([]);
  const [error, setError] = useState("");
  const call = useCallback(async (init?: RequestInit) => {
    if (!chatId) return;
    try {
      const res = await fetch(`/api/core/checkpoint${init ? "" : `?id=${encodeURIComponent(chatId)}`}`, init);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
      setLines(j.lines ?? []); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "failed"); }
  }, [chatId]);
  useEffect(() => { setLines([]); void call(); }, [call]);
  const post = (body: Record<string, unknown>) => call({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: chatId, ...body }) });
  if (!chatId || (!lines.length && !error)) return null;
  return (
    <section className="mt-3 rounded-lg bg-white/5 p-2" aria-label={t("cp.title")}>
      <div className="h3">{t("cp.title")}</div>
      <p className="muted text-xs">{t("cp.help")}</p>
      {error && <p className="error text-xs" role="alert">{error}</p>}
      <ul className="mt-1 space-y-1">
        {lines.map((l) => (
          <li key={l.id} className="flex items-start gap-1 text-xs">
            <span className="muted shrink-0">{t(`cp.k.${l.kind}` as Parameters<typeof t>[0])}:</span>
            <span className="min-w-0 flex-1 break-words">{l.text}{l.v ? ` (v${l.v})` : ""}</span>
            <button type="button" className="chip px-2" aria-label={t("cp.editL", { x: l.text })} title={t("cp.edit")}
              onClick={async () => { const v = (await askText(t("cp.editAsk"), { value: l.text }))?.trim(); if (v && v !== l.text) void post({ action: "edit", line: l.id, text: v.slice(0, MAX_TEXT) }); }}>✎</button>
            <button type="button" className="chip px-2" aria-label={t("cp.delL", { x: l.text })} title={t("cp.del")}
              onClick={async () => { if ((await askConfirm(t("cp.delAsk", { x: l.text })))) void post({ action: "delete", line: l.id }); }}>✕</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
