"use client";
// A finished CORE answer with inline numbered citations (core-cite-pure.ts): a small number after each claim opens its source
// (web page, VAULT file, memory, week item); the numbered list under the answer says what each one is. A "!" number = the page
// doesn't back the claim (local fact check), "?" = CORE never opened that page this turn, "no source" = a figure with no source.
import { memo, useCallback, useMemo } from "react";
import { citeAnswer, parseMarker, traceCite, type Cite, type SourceRef } from "@/lib/core-cite-pure";
import { OPEN_SOURCE_EVENT } from "@/lib/week-pure";
import { ChatAnswer } from "./ChatAnswer";
import { useT } from "./i18n";
import type { Key } from "@/lib/i18n-pure";

type Props = { content: string; citations?: Cite[]; trace?: { step: string; cite?: unknown }[]; openMemory: (id: string) => void };

export const CitedAnswer = memo(function CitedAnswer({ content, citations, trace, openMemory }: Props) {
  const { t } = useT();
  const { text, sources } = useMemo(() => citeAnswer(content, citations ?? [], traceCite(trace)), [content, citations, trace]);
  const open = useCallback((s: SourceRef) => {
    if (s.kind === "memory" && s.id) openMemory(s.id);
    else if (s.kind === "week" && s.cite) dispatchEvent(new CustomEvent(OPEN_SOURCE_EVENT, { detail: s.cite }));
    else if (s.href) window.open(s.href, "_blank", "noopener,noreferrer");
  }, [openMemory]);
  const tip = useCallback((s: SourceRef) => [t(`cite.kind.${s.kind}` as Key), s.title, s.check === "not_backed" || s.check === "contradicted" ? t("cite.notBacked") : s.check === "unopened" ? t("cite.unopened") : s.check === "backed" ? t("cite.backed") : ""].filter(Boolean).join(" · "), [t]);
  const cite = useCallback((tok: string, key: number) => {
    const m = parseMarker(tok);
    if (m === "nosrc") return <span key={key} className="cite-mark cite-none" title={t("cite.noSourceTitle")}>{t("cite.noSource")}</span>;
    const s = m && sources[m.n - 1];
    if (!m || !s) return null;
    return <button key={key} type="button" className={`cite-mark${m.flag ? " cite-warn" : ""}`} title={tip(s)} aria-label={`${t("cite.source")} ${s.n}: ${tip(s)}`} onClick={() => open(s)}>{s.n}{m.flag}</button>;
  }, [sources, open, tip, t]);
  return (
    <>
      <ChatAnswer text={text} openMemory={openMemory} cite={cite} />
      {!!sources.length && (
        <ol className="cite-list" aria-label={t("cite.sources")}>
          {sources.map((s) => (
            <li key={s.n}>
              <button type="button" className="cite-row" onClick={() => open(s)} disabled={!s.href && !s.id} title={tip(s)}>
                <span className="cite-num">{s.n}</span>
                <span className="cite-kind">{t(`cite.kind.${s.kind}` as Key)}</span>
                <span className="min-w-0 truncate">{s.title}</span>
                {(s.check === "not_backed" || s.check === "contradicted") && <span className="cite-flag">{t("cite.notBacked")}</span>}
                {s.check === "unopened" && <span className="cite-flag">{t("cite.unopened")}</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </>
  );
});
