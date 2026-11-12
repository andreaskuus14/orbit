import test from "node:test";
import assert from "node:assert/strict";
// @ts-ignore plain .mjs helper used by the PC trial scripts (tools/trials)
import { errorRates, parseClips, norm } from "../tools/trials/lib/util.mjs";

test("errorRates: exact, one substitution, Estonian letters, empty hypothesis", () => {
  assert.deepEqual(errorRates("Open the door.", "open the door"), { wer: 0, cer: 0 });
  assert.equal(errorRates("one two three four", "one too three four").wer, 0.25);
  assert.equal(norm("Tuleta mulle meelde, õhtul!"), "tuleta mulle meelde õhtul");
  assert.equal(errorRates("üks kaks", "").wer, 1);
});

test("parseClips reads id<TAB>sentence and skips comments", () => {
  assert.deepEqual(parseClips("# c\nen-01\tHello there\n\net-02\tTere"), [{ id: "en-01", lang: "en", text: "Hello there" }, { id: "et-02", lang: "et", text: "Tere" }]);
});
