// Browser stand-in for i18n-pure.ts (next.config.ts swaps it in for client bundles only): same translate()/plural() API,
// but strings come from the dictionaries loaded so far (the active language, see components/i18n.tsx), not both at once.
// EN and ET are deliberately not exported: a browser import of them fails the build instead of shipping ~470 kB again.
import { lookup, pluralKey, type Key, type Lang, type PluralBase, type Vars } from "./i18n-core-pure.ts";
export * from "./i18n-core-pure.ts";

type Dict = Partial<Record<Key, string>>;
export const dicts: Partial<Record<Lang, Dict>> = {};

export function translate(lang: Lang, key: Key, vars?: Vars): string {
  return lookup(dicts.en, dicts.et, lang, key, vars);
}
export function plural(lang: Lang, base: PluralBase, n: number, vars?: Vars): string {
  return translate(lang, pluralKey(base, n), { ...vars, n });
}
