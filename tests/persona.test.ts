import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PERSONA, SLIDERS, applyProposal, cleanPersona, parseStore, personaPrompt, previewLine, proposalText, pushBody, reactionProposal,
  type Level, type Persona, type Surface } from "../src/lib/persona-pure.ts";

const NOW = Date.parse("2026-10-26T10:00:00Z");
const SURFACES: Surface[] = ["chat", "call", "brief", "opener"];
function* every(): Generator<Persona> {
  for (let i = 0; i < 256; i++) yield { warmth: (i & 3) as Level, humour: ((i >> 2) & 3) as Level, directness: ((i >> 4) & 3) as Level, verbosity: ((i >> 6) & 3) as Level, voice: "" };
}

test("persona text never instructs flattery or suppressing disagreement, at any setting on any surface", () => {
  const positive = /\b(?:flatter|praise|compliment|agree with him|tell him what he wants|avoid (?:disagree|conflict)|don'?t (?:disagree|push back|contradict)|hide (?:problems|disagreement))/i;
  for (const p of every()) for (const s of SURFACES) {
    const t = personaPrompt(p, s);
    for (const line of t.split("\n")) {
      // any line that mentions flattery/praise/agreement must be a prohibition
      if (positive.test(line) || /\bagree\b/i.test(line)) assert.match(line, /\b(?:never|no|not|without)\b/i, `${JSON.stringify(p)} ${s}: ${line}`);
    }
    assert.match(t, /Honest disagreement: if he is wrong .* say so once/);
    assert.match(t, /Never pretend to agree/);
    assert.match(t, /Never flatter him/);
    assert.match(t, /Uncertainty: say how sure you are/);
    assert.match(t, /Never say "As an AI"/);
    assert.doesNotMatch(t.replace(/Never say "As an AI"[^\n]*/, ""), /as an ai/i);
  }
});

test("sliders change the words", () => {
  const p = { ...DEFAULT_PERSONA };
  assert.match(personaPrompt({ ...p, humour: 0 }, "chat"), /No jokes\./);
  assert.match(personaPrompt({ ...p, humour: 3 }, "chat"), /alien's-eye/);
  assert.match(personaPrompt({ ...p, verbosity: 0 }, "call"), /under 15 words/);
  assert.match(personaPrompt({ ...p, directness: 3 }, "chat"), /verdict in the first sentence/);
  assert.match(personaPrompt({ ...p, directness: 0 }, "chat"), /then name the problem plainly/); // gentle still names it
  assert.notEqual(personaPrompt(p, "chat"), personaPrompt(p, "call"));
});

test("cleanPersona keeps valid values and falls back otherwise", () => {
  assert.deepEqual(cleanPersona({ warmth: 0, humour: 9, directness: "3", verbosity: 3, voice: "am_michael" }), { ...DEFAULT_PERSONA, warmth: 0, verbosity: 3, voice: "am_michael" });
  assert.equal(cleanPersona({ voice: "../../etc" }).voice, "");
  assert.deepEqual(cleanPersona(null), DEFAULT_PERSONA);
  assert.equal(cleanPersona({ humour: 3 }, { ...DEFAULT_PERSONA, warmth: 0 }).warmth, 0); // partial update keeps the rest
});

test("reactions propose one slider step; long messages and no-ops don't", () => {
  const p = { ...DEFAULT_PERSONA, humour: 2 as Level, verbosity: 2 as Level };
  assert.deepEqual(reactionProposal("too long", p, NOW), { slider: "verbosity", to: 1, said: "too long", at: new Date(NOW).toISOString() });
  assert.equal(reactionProposal("Stop joking please", p, NOW)?.to, 0);
  assert.equal(reactionProposal("stop joking", p, NOW)?.slider, "humour");
  assert.equal(reactionProposal("more detail", p, NOW)?.to, 3);
  assert.equal(reactionProposal("just tell me", p, NOW)?.slider, "directness");
  assert.equal(reactionProposal("you sound so cold", p, NOW)?.slider, "warmth");
  assert.equal(reactionProposal("too long", { ...p, verbosity: 0 }, NOW), null); // already minimal
  assert.equal(reactionProposal("my latest short is too long, which part of the intro should I cut so it fits under a minute?", p, NOW), null);
  assert.equal(reactionProposal("thanks", p, NOW), null);
  const pr = reactionProposal("tl;dr", p, NOW)!;
  assert.equal(proposalText(pr, p), "Verbosity normal → short (you said “tl;dr”)");
  assert.equal(applyProposal(p, pr).verbosity, 1);
});

test("preview line follows the sliders and always disagrees", () => {
  for (const p of every()) assert.match(previewLine(p), /two tests (?:still )?fail/i);
  const min = previewLine({ warmth: 0, humour: 0, directness: 3, verbosity: 0, voice: "" });
  assert.equal(min, "Don't ship tonight. Two tests fail.");
  assert.match(previewLine({ warmth: 3, humour: 3, directness: 0, verbosity: 3, voice: "" }), /launch-night sacrifice.*last mile/);
});

test("push keeps fixed labels; dry body only at humour 2+", () => {
  assert.equal(pushBody("failed", "Check ORBIT on the PC to see why.", DEFAULT_PERSONA), "Check ORBIT on the PC to see why.");
  assert.match(pushBody("failed", "x", { ...DEFAULT_PERSONA, humour: 2 }), /Not me, for once/);
  assert.equal(pushBody("clip", "Approve or reject it in Remote.", { ...DEFAULT_PERSONA, humour: 3 }), "Approve or reject it in Remote.");
});

test("parseStore: empty, broken, and cleaned", () => {
  assert.deepEqual(parseStore(""), { v: 1, users: {} });
  assert.equal(parseStore("{nope"), null);
  assert.equal(parseStore('{"v":2,"users":{}}'), null);
  assert.deepEqual(parseStore('{"v":1,"users":{"u":{"persona":{"humour":7}}}}')!.users.u.persona, DEFAULT_PERSONA);
  assert.equal(SLIDERS.length, 4);
});
