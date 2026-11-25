// UI labels for the contract form (tested in tests/contracts-i18n.test.ts). Only the form chrome is translated: the contract
// text itself (clauses, defaults, role words) stays the vetted English template, never machine-translated.
import type { Key } from "./i18n-en-pure.ts";
import type { FieldKey, TemplateId } from "./contracts-pure.ts";

// These four fields mean something different in each template ("Handover place" vs "Delivery date"), so they get per-template keys.
const PER_TEMPLATE = new Set<FieldKey>(["scope", "startDate", "endDate", "extra"]);
export const fieldLabelKey = (tpl: TemplateId, key: FieldKey): Key => (PER_TEMPLATE.has(key) ? `ctf.${tpl}.${key}` : `ctf.${key}`) as Key;
export const templateTitleKey = (tpl: TemplateId): Key => `ctp.tpl.${tpl}` as Key;
export const templateBlurbKey = (tpl: TemplateId): Key => `ctp.blurb.${tpl}` as Key;
export const statusKey = (s: string): Key => `ctp.st.${s}` as Key;
