"use client";
// The chosen UI language (localStorage "orbit.lang", per device) as a tiny shared store: useT() works in any tree, the PC galaxy
// and the phone /remote alike, with no provider to mount. Strings and rules: lib/i18n-pure.ts.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { LANG_KEY, parseLang, plural, translate, type Lang } from "@/lib/i18n-pure";

const subs = new Set<() => void>();
let mem: Lang = "en"; // used when storage is blocked
export function getLang(): Lang {
  try { return parseLang(localStorage.getItem(LANG_KEY)); } catch { return mem; }
}
export function setLang(lang: Lang) {
  mem = lang;
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* no storage: this tab only */ }
  document.documentElement.lang = lang;
  subs.forEach((f) => f());
}
function subscribe(f: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === LANG_KEY) f(); }; // another window switched
  subs.add(f); addEventListener("storage", onStorage);
  return () => { subs.delete(f); removeEventListener("storage", onStorage); };
}

export function useT() {
  const lang = useSyncExternalStore(subscribe, getLang, () => "en" as Lang); // server render: English
  useEffect(() => { document.documentElement.lang = lang; }, [lang]); // screen readers pronounce Estonian as Estonian
  return useMemo(() => ({
    lang,
    t: (...a: Parameters<typeof translate> extends [Lang, ...infer R] ? R : never) => translate(lang, ...a),
    tn: (...a: Parameters<typeof plural> extends [Lang, ...infer R] ? R : never) => plural(lang, ...a),
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
