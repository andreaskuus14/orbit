// Every contract form label (fields, template names/blurbs, statuses) has English and Estonian text; the contract text does not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TEMPLATES, TEMPLATE_IDS, STATUS_LABEL } from "../src/lib/contracts-pure.ts";
import { fieldLabelKey, statusKey, templateBlurbKey, templateTitleKey } from "../src/lib/contracts-i18n-pure.ts";
import { EN } from "../src/lib/i18n-en-pure.ts";
import { ET } from "../src/lib/i18n-et-pure.ts";

const keys = [
  ...TEMPLATE_IDS.flatMap((id) => [templateTitleKey(id), templateBlurbKey(id), ...TEMPLATES[id].fields.map((f) => fieldLabelKey(id, f.key))]),
  ...Object.keys(STATUS_LABEL).map(statusKey),
];

test("contract form labels exist in English and Estonian", () => {
  assert.deepEqual(keys.filter((k) => !EN[k] || !ET[k]), []);
});

test("English labels match the template's own wording (no drift from contracts-pure)", () => {
  for (const id of TEMPLATE_IDS) {
    assert.equal(EN[templateTitleKey(id)], TEMPLATES[id].title);
    assert.equal(EN[templateBlurbKey(id)], TEMPLATES[id].blurb);
    for (const f of TEMPLATES[id].fields) assert.equal(EN[fieldLabelKey(id, f.key)], f.label, `${id}.${f.key}`);
  }
  for (const [s, label] of Object.entries(STATUS_LABEL)) assert.equal(EN[statusKey(s)], label);
});
