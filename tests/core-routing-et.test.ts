// Review 1c4cd6c finding 1: equivalent English and Estonian requests must expose the same CORE modules (acceptance check).
import { test } from "node:test";
import assert from "node:assert/strict";
import { MODULE_ABOUT, MODULE_HINTS, loadModule, routedPrompt, selectModules } from "../src/lib/core-modules-pure.ts";

const mods = [...Object.keys(MODULE_HINTS), "REA", "MISSIONS", "LOAD"].map((name) => ({ name, prompt: `- ${name} tools`, tools: [`${name.toLowerCase()}_x`] }));
const picked = (text: string) => selectModules(mods, text).filter((m) => MODULE_HINTS[m.name]).map((m) => m.name).sort();

// [module, English, Estonian]
const PAIRS: [string, string, string][] = [
  ["STUDIO", "Make 5 shorts from the stream", "Tee striimist 5 shorti"],
  ["STUDIO", "How is my YouTube channel doing?", "Kuidas mu YouTube'i kanalil läheb?"],
  ["STUDIO", "Schedule the approved clips", "Ajasta heakskiidetud klipid"],
  ["STUDIO", "What should I work on next?", "Millega ma järgmisena tegelema peaksin?"],
  ["LIFE", "Remind me to call mom", "Tuleta mulle meelde emale helistada"],
  ["LIFE", "How are my habits?", "Kuidas mu harjumustega läheb?"],
  ["LIFE", "What's in my calendar tomorrow?", "Mis mu kalendris homme on?"],
  ["LIFE", "Show my journal", "Näita mu päevikut"],
  ["REACH", "What's trending on Reddit?", "Mis on Redditis trendis?"],
  ["REACH", "Which clips are going viral?", "Millised klipid on viraalsed?"],
  ["REACH", "What's exploding on Twitch right now?", "Mis Twitchis praegu plahvatab?"],
  ["WORKSPACE", "Build me a website", "Ehita mulle veebileht"],
  ["WORKSPACE", "Show the code of my app", "Näita mu äpi koodi"],
  ["WORKSPACE", "Create a page for the shop", "Loo poe jaoks leht"],
  ["BUSINESS", "How is my business going?", "Kuidas mu äril läheb?"],
  ["BUSINESS", "Which clients need a follow-up?", "Millised kliendid vajavad järelkontakti?"],
  ["BUSINESS", "Show my customers", "Näita mu kliente"],
  ["IDEAS", "Show my ideas", "Näita mu ideid"],
  ["IDEAS", "Any good idea for a video?", "Kas on mõni hea idee video jaoks?"],
  ["IDEAS", "What new ideas came in?", "Mis uued ideed tulid?"],
  ["HIGGSFIELD", "Make me a picture", "Tee mulle pilt"],
  ["HIGGSFIELD", "Draw a fox in the snow", "Joonista rebane lumes"],
  ["HIGGSFIELD", "Generate two photos of a cat", "Genereeri kaks kassi fotot"],
  ["GOALS", "Show my goals", "Näita minu eesmärke"],
  ["GOALS", "How is the progress on my goal?", "Kuidas mu eesmärgi edenemine on?"],
  ["GOALS", "How many subscribers do I have?", "Mitu tellijat mul on?"],
  ["GOALS", "When is the deadline?", "Millal on tähtaeg?"],
  ["NIGHT", "Look into this tonight", "Uuri seda täna öösel"],
  ["NIGHT", "Research it overnight", "Uuri seda öö jooksul"],
  ["NIGHT", "Work on it at night", "Tegele sellega öösel"],
  ["DEALS", "Find a cheap used laptop", "Leia odav kasutatud sülearvuti"],
  ["DEALS", "I want to buy an RTX 4070", "Ma tahan osta RTX 4070"],
  ["DEALS", "What's on my wishlist?", "Mis on mu soovinimekirjas?"],
  ["DEALS", "What price is good for a monitor?", "Mis hind on monitorile hea?"],
  ["RULES", "Every weekday check prices", "Igal tööpäeval kontrolli hindu"],
  ["RULES", "Whenever a client replies, draft an answer", "Alati kui klient vastab, koosta vastus"],
  ["RULES", "Show my rules", "Näita mu reegleid"],
  ["WEEK", "Show this week's wins", "Näita selle nädala saavutusi"],
  ["WEEK", "What slipped?", "Mis maha jäi?"],
  ["WEEK", "What's late?", "Mis on hiljaks jäänud?"],
  ["WEEK", "How is my streak?", "Kuidas mu seeria on?"],
  ["CHECKPOINT", "Remember for this chat: no red", "Pea selle vestluse jaoks meeles: punast ei kasuta"],
  ["CHECKPOINT", "Continue where I stopped", "Jätka sealt, kus pooleli jäin"],
  ["CHECKPOINT", "Save a checkpoint with the next step", "Salvesta järgmine samm"],
];

test("every keyword-gated module has ≥3 EN/ET pairs and a capability line", () => {
  for (const name of Object.keys(MODULE_HINTS)) {
    assert.ok(PAIRS.filter((p) => p[0] === name).length >= 3, name);
    assert.ok(MODULE_ABOUT[name], name);
  }
});

test("EN and ET requests select the same module set, which includes the intended module", () => {
  for (const [name, en, et] of PAIRS) {
    assert.ok(picked(en).includes(name), `${name}: ${en} → ${picked(en)}`);
    assert.deepEqual(picked(et), picked(en), `${en} | ${et}`);
  }
});

test("no gated match → capability index naming load_module; a match → no index", () => {
  const miss = routedPrompt(mods, "Tere, kuidas läheb?");
  assert.match(miss, /- REA tools\n- MISSIONS tools\n- LOAD tools\nOTHER ORBIT MODULES[^\n]*load_module/);
  for (const name of Object.keys(MODULE_HINTS)) assert.match(miss, new RegExp(`\\n- ${name}: ${MODULE_ABOUT[name].slice(0, 20).replace(/[()/]/g, ".")}`));
  assert.doesNotMatch(routedPrompt(mods, "Näita minu eesmärke"), /OTHER ORBIT MODULES/);
  assert.match(routedPrompt(mods, "Näita minu eesmärke"), /- GOALS tools/);
});

test("load_module returns the module's instructions, or an error for unknown names", () => {
  assert.equal(loadModule(mods, "goals"), "- GOALS tools");
  assert.match(loadModule(mods, "nope"), /^Error: unknown module "nope" \(known: STUDIO/);
  assert.match(loadModule(mods, undefined), /^Error: unknown module/);
});
