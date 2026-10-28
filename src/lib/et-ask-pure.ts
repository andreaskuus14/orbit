// Estonian halves of CORE's explicit-ask guards (tested in tests/et-ask.test.ts and the real-request set). JS \b is ASCII-only,
// so Estonian words use these Unicode-letter edges. Guards stay "owner's own imperative in the latest message": these only widen the
// words that count; the taint (page/file/agent text in context) refusal is untouched.
const L = "(?<![\\p{L}\\d])";
/** Wrap alternatives with Estonian-safe word starts (no end edge: Estonian adds case endings). */
export const et = (src: string) => new RegExp(`${L}(?:${src})`, "iu");
/** A question, not an order ("Kas …", "Mis …", "Kuidas …"). */
export const ET_QUESTION = et("(?:hei\\s+orbit\\W*)?(?:kas|mis|miks|kuidas|millal|milline|millised|kes|kus|palju)(?![\\p{L}])");
export const etQuestion = (q: string) => /\?\s*$/.test(q) || new RegExp(`^\\s*${ET_QUESTION.source}`, "iu").test(q);
/** "don't / never / stop / cancel". */
export const ET_NOT = et("ära |ärge |ärgu |mitte |kunagi |lõpeta|tühista|katkesta");
