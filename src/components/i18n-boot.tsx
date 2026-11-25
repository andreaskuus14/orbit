"use client";
// The language the server rendered this page in (cookie "orbit.lang", app/layout.tsx), for useT() in components/i18n.tsx.
// Kept apart from i18n.tsx so pages that never translate (e.g. /login) load no dictionary at all.
import { createContext } from "react";
import type { Lang } from "@/lib/i18n-core-pure";

export const LangCtx = createContext<Lang>("en");
export function LangBoot({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangCtx.Provider value={lang}>{children}</LangCtx.Provider>;
}
