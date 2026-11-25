// Tiny i18n: English is the source and the fallback, Estonian covers the most-seen surfaces (HUD, ⋯ menu, planets, morning
// cards, approvals, Profile titles, the phone Remote, Life, Doctor/SYSTEM, night shift, rules, open loops). No dependency.
// Both languages, for server code and tests. Strings: i18n-en-pure.ts (BASE) + i18n-et-pure.ts (ET). Browser code imports
// components/i18n.tsx or i18n-core-pure.ts instead, so only the active language ships in the first-load bundle.
import { lookup, pluralKey, type Lang, type PluralBase, type Vars } from "./i18n-core-pure.ts";
import { EN } from "./i18n-en-pure.ts";
import { ET } from "./i18n-et-pure.ts";
import type { Key } from "./i18n-en-pure.ts";
export * from "./i18n-core-pure.ts";
export { EN } from "./i18n-en-pure.ts";
export { ET } from "./i18n-et-pure.ts";

export function translate(lang: Lang, key: Key, vars?: Vars): string {
  return lookup(EN, ET, lang, key, vars);
}
export function plural(lang: Lang, base: PluralBase, n: number, vars?: Vars): string {
  return translate(lang, pluralKey(base, n), { ...vars, n });
}
