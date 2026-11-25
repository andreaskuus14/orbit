"use client";
// The chosen UI language as a tiny shared store: useT() works in any tree, the PC galaxy and the phone /remote alike.
// The server picks the language from the "orbit.lang" cookie (app/layout.tsx), renders the page in it and sets <html lang>.
// Both dictionaries are lazy chunks: the browser fetches only the one <html lang> names, and only on pages that call useT().
// Hydration waits for it (useT suspends), so the server's HTML stays on screen and no frame shows the other language or raw keys.
// Switching loads the other dictionary on demand, then swaps. localStorage keeps the old per-device setting; the cookie mirrors it.
import { use, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { LANG_KEY, langCookie, lookup, parseLang, pluralKey, tx, type Key, type Lang, type PluralBase, type Vars } from "@/lib/i18n-core-pure";
import { dicts } from "@/lib/i18n-browser";
import { LangCtx } from "./i18n-boot";

let boot: Lang = "en"; // language the server rendered this page in (set by the dictionary component)
let chosen: Lang | null = null; // switched in this tab after load
const subs = new Set<() => void>();

// One promise per language, tagged the way React's use() reads it, so once loaded every use() returns at once (no suspend).
type Tracked = Promise<void> & { status?: "fulfilled"; value?: void };
const pending: Partial<Record<Lang, Tracked>> = {};
const load = (lang: Lang): Tracked => {
  if (!pending[lang]) {
    const p: Tracked = (lang === "et"
      ? import("@/lib/i18n-et-pure").then((m) => { dicts.et = m.ET; })
      : import("@/lib/i18n-en-pure").then((m) => { dicts.en = m.EN; }));
    p.then(() => { p.status = "fulfilled"; p.value = undefined; }, () => { delete pending[lang]; });
    pending[lang] = p;
  }
  return pending[lang]!;
};
// Start the download the moment this chunk runs, before React starts hydrating.
if (typeof document !== "undefined") void load(parseLang(document.documentElement.lang));

export function getLang(): Lang {
  return chosen ?? boot;
}
/** Translate outside React (toasts, voice commands): uses the current language. */
export function tr(key: Key, vars?: Vars): string {
  return lookup(dicts.en, dicts.et, getLang(), key, vars);
}

function apply(lang: Lang) {
  chosen = lang;
  document.documentElement.lang = lang;
  subs.forEach((f) => f());
}
export function setLang(lang: Lang) {
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* no storage: the cookie still remembers */ }
  document.cookie = langCookie(lang);
  void load(lang).then(() => apply(lang), () => { /* offline: stay in the current language */ });
}
function subscribe(f: () => void) {
  const onStorage = (e: StorageEvent) => { // another window switched
    if (e.key !== LANG_KEY) return;
    const l = parseLang(e.newValue);
    void load(l).then(() => apply(l), () => {});
  };
  subs.add(f); addEventListener("storage", onStorage);
  return () => { subs.delete(f); removeEventListener("storage", onStorage); };
}

export function useT() {
  const served = useContext(LangCtx);
  use(load(served) as Promise<void>); // always called (same hook order on every render); waits only until the dictionary arrives, with the server's HTML still showing
  if (typeof window !== "undefined") boot = served; // server: the per-request value lives in LangCtx, never a module global
  const lang = useSyncExternalStore(subscribe, () => chosen ?? served, () => served);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]); // screen readers pronounce Estonian as Estonian
  return useMemo(() => ({
    lang,
    t: (key: Key, vars?: Vars) => lookup(dicts.en, dicts.et, lang, key, vars),
    tn: (base: PluralBase, n: number, vars?: Vars) => lookup(dicts.en, dicts.et, lang, pluralKey(base, n), { ...vars, n }),
    tx: (key: string, en: string) => tx(lang, key, en), // server-sent English by its stable id
  }), [lang]);
}

/** English / Eesti switch (Profile, phone Remote). */
export function LangSwitch() {
  const { lang, t } = useT();
  return (
    <div className="flex items-center gap-2 text-sm" role="group" aria-label={t("lang.title")}>
      <span>{t("lang.title")}</span>
      {(["en", "et"] as const).map((l) => (
        <button key={l} type="button" className="chip" aria-pressed={lang === l} lang={l} onClick={() => setLang(l)}>{l === "en" ? "English" : "Eesti"}</button>
      ))}
    </div>
  );
}
