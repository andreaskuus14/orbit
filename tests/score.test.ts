import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KEYS, MIN_FIT, PRIOR, bestLength, factorText, features, fitRidge, hookStrength, modelFrom, nearest, predict, priorModel, rankScore, scoreFrom, trainingRows, type FVec,
} from "../src/lib/clips/score-pure.ts";
import { buildHype } from "../src/lib/clips/hype-pure.ts";
import type { LearnRec } from "../src/lib/clips/learn-pure.ts";
import type { Prefs } from "../src/lib/clips/autopilot-pure.ts";

const w = (start: number, text: string, loud = false) => ({ start, end: start + 0.3, text, loud });
const clip = { start: 300, end: 330, score: 0.8, title: "Kai loses it at chat", hook: "NO WAY", reason: "rage at a donation" };

test("hookStrength: fast, loud, attention words beat a slow start; unknown without a transcript", () => {
  const strong = hookStrength([w(300, "Bro"), w(300.4, "what"), w(300.8, "is"), w(1.2 + 300, "THAT?!", true), w(301.6, "no"), w(302, "way")], 300)!;
  const weak = hookStrength([w(302.3, "so"), w(310, "anyway")], 300)!;
  assert.ok(strong > 0.8 && weak < 0.3, `${strong} ${weak}`);
  assert.equal(hookStrength([], 300), null);
  assert.equal(hookStrength([w(10, "hi")], 300), 0.1); // transcribed elsewhere, silent here
});

test("bestLength: learned band with ≥ 2 Shorts and > 1×, else a generic range", () => {
  const p: Prefs = { at: "", n: 9, dims: { length: { "20-30": { n: 4, mult: 1.6 }, "40+": { n: 3, mult: 0.7 }, "30-40": { n: 1, mult: 3 } } } };
  assert.deepEqual(bestLength(p), { lo: 20, hi: 30, learned: true });
  assert.deepEqual(bestLength(undefined), { lo: 20, hi: 35, learned: false });
});

test("nearest: token overlap with recent titles", () => {
  assert.ok(nearest("Kai loses it at chat", ["Kai loses it again at chat", "Speed eats a pepper"]).sim > 0.5);
  assert.equal(nearest("totally new", ["Speed eats a pepper"]).sim, 0);
});

test("features: neutral-missing without signals; hype/chat/length/creator/kind filled when known", () => {
  const bare = features(clip, { words: [], creator: "unknown", recent: [] });
  assert.deepEqual(Object.keys(bare.x).sort(), ["claude", "length"]); // nothing else is known
  const rms = new Array(1200).fill(0.02);
  for (let i = 640; i < 646; i++) rms[i] = 0.4; // scream at 320 s
  const chat = Array.from({ length: 300 }, (_, k) => ({ t: k * 2, author: `u${k % 9}`, text: "hi", kind: "msg" as const }));
  for (let k = 0; k < 50; k++) chat.push({ t: 325 + (k % 3), author: `f${k}`, text: "KEKW", kind: "msg" });
  const hype = buildHype({ rms, duration: 600, chat: chat.sort((a, b) => a.t - b.t) });
  const p: Prefs = { at: "", n: 10, dims: { creator: { "Kai Cenat": { n: 5, mult: 1.8 } }, kind: { rage: { n: 4, mult: 0.6 } } } };
  const f = features({ ...clip, end: 360 }, { hype, words: [w(300, "Bro"), w(300.5, "what")], creator: "Kai_Cenat", prefs: p, recent: ["Kai loses it at chat again"],
    playbook: { n: 6, lengthSec: 30, payoffAt: 0.7 } as never });
  assert.ok(f.x.hypePeak! > 0.4 && f.x.audio! > 0.5 && f.x.chat! > 0.3, JSON.stringify(f.x));
  assert.ok(f.d.chatX! > 3);
  assert.equal(f.d.len, 60);
  assert.ok(f.x.length! < 0.1); // 60 s vs best 20–35
  assert.ok(f.x.creator! > 0.8 && f.d.cm === 1.8); // "Kai_Cenat" matches "Kai Cenat"
  assert.ok(f.x.kind! < 0.2 && f.d.kind === "rage");
  assert.ok(f.x.novelty! < 0.3 && f.d.similar);
  assert.ok(f.x.playbook! >= 0 && f.x.playbook! <= 1);
});

test("fitRidge: recovers weights from a deterministic dataset; λ pulls toward the prior", () => {
  const rows: { x: FVec; y: number }[] = [];
  for (let i = 0; i < 40; i++) {
    const x: FVec = { chat: (i % 5) / 4, hook: ((i * 3) % 7) / 6, length: ((i * 7) % 9) / 8 };
    rows.push({ x, y: 0.2 + 2 * (x.chat! - 0.5) - 1 * (x.hook! - 0.5) });
  }
  const m = fitRidge(rows, PRIOR, 0.001);
  assert.ok(Math.abs(m.w.chat - 2) < 0.02 && Math.abs(m.w.hook + 1) < 0.02 && Math.abs(m.w.length) < 0.02, JSON.stringify(m.w));
  assert.ok(Math.abs(m.b - 0.2) < 0.02);
  assert.equal(m.w.creator, PRIOR.creator); // never seen (always neutral): stays at its prior
  const shrunk = fitRidge(rows.slice(0, 8), PRIOR, 50);
  assert.ok(Math.abs(shrunk.w.chat - PRIOR.chat) < Math.abs(m.w.chat - PRIOR.chat));
});

const rec = (i: number, views: number, feat?: Record<string, number>): LearnRec => ({ videoId: `vid${String(i).padStart(8, "0")}`, jobId: "j", clipId: `clip-${i}`, title: "t", hook: "", reason: "",
  layout: "fit", captions: "karaoke", durationSec: 25, sourceChannel: "Kai", kind: "other", snaps: { "72h": { at: "x", views, likes: views / 20, comments: 0 } }, feat });

test("trainingRows / modelFrom: priors until MIN_FIT Shorts with features, then learned", () => {
  const few = Array.from({ length: MIN_FIT - 1 }, (_, i) => rec(i, 1000 * (i + 1), { chat: i / 10 }));
  assert.equal(trainingRows([...few, rec(99, 5000)]).length, MIN_FIT - 1); // no features: not a training row
  assert.deepEqual(modelFrom(few), { ...priorModel(), n: MIN_FIT - 1 });
  const enough = Array.from({ length: 12 }, (_, i) => rec(i, i % 2 ? 4000 : 1000, { chat: i % 2 ? 0.9 : 0.1 }));
  const m = modelFrom(enough);
  assert.ok(m.learned && m.n === 12 && m.w.chat > PRIOR.chat);
  const rows = trainingRows(enough);
  assert.ok(rows[1].y > 0 && rows[0].y < 0);
});

test("scoreFrom: 50 = usual, factors ranked and worded, confidence + learning label", () => {
  const neutral = scoreFrom(priorModel(), {}, {});
  assert.equal(neutral.score, 50);
  assert.equal(neutral.conf, "low");
  assert.equal(neutral.learning, true);
  assert.deepEqual([neutral.up, neutral.down], [[], []]);
  const v = scoreFrom(priorModel(), { chat: 0.95, hypePeak: 0.7, claude: 0.8, length: 0.1, novelty: 0.2 }, { chatX: 4.2, claude10: 8, len: 50, lo: 28, hi: 35, learnedLen: true });
  assert.ok(v.score > 55 && v.score < 80, String(v.score));
  assert.equal(v.up[0].text, "Chat exploded (4.2× normal)");
  assert.equal(v.up.length, 3);
  assert.equal(v.down[0].text, "Too long for your channel (best 28–35 s)");
  assert.ok(v.up.every((f) => f.pts > 0) && v.down.every((f) => f.pts < 0));
  assert.ok(Math.abs(Math.log(v.mult) - predict(priorModel(), v.x)) < 0.01);
  const learned = scoreFrom({ ...priorModel(), learned: true, n: 30 }, {}, {});
  assert.deepEqual([learned.conf, learned.learning], ["high", false]);
});

test("factorText: every key has both directions in plain words", () => {
  const d = { claude10: 7, chatX: 1.1, len: 12, lo: 20, hi: 30, learnedLen: true, creator: "Kai", cm: 1.4, kind: "rage", km: 0.7, similar: "Kai rages" };
  for (const k of KEYS) for (const up of [true, false]) assert.ok(factorText(k, up, { hypePeak: 0.95 }, d).length > 8, `${k} ${up}`);
  assert.equal(factorText("length", false, {}, d), "Too short for your channel (best 20–30 s)");
  assert.equal(factorText("length", true, {}, { ...d, learnedLen: false }), "Right length for your channel (best 20–30 s, a typical Shorts range)");
  assert.equal(factorText("kind", false, {}, d), "Rage moments under-perform for you (0.7×)");
});

test("rankScore: virality first, else near-neutral 50 keeping editor order", () => {
  assert.equal(rankScore({ score: 0.75 }), 50);
  assert.equal(rankScore({ score: 85 }), 52);
  assert.ok(rankScore({ score: 0.9 }) < rankScore({ score: 0.6, virality: { score: 60 } }));
  assert.equal(rankScore({ score: 0.9, virality: { score: 61 } }), 61);
});

test("syncRecords stores the clip's features for learning; creatorVirality + rankCandidates blend them in", async () => {
  const { syncRecords, learnProblem } = await import("../src/lib/clips/learn-pure.ts");
  const { creatorVirality, rankCandidates } = await import("../src/lib/clips/autopilot-pure.ts");
  const v = { ...scoreFrom(priorModel(), { chat: 0.9 }, { chatX: 5 }), score: 80 };
  const mk = (id: string, extra = {}) => ({ id, start: 0, end: 25, title: "t", hook: "", reason: "", score: 0.5, status: "ready" as const, virality: v, ...extra });
  const job = { id: "j1", source: "Kai_Cenat_-_Stream_[abcdefghijk].mp4", createdAt: "", updatedAt: "", status: "done" as const, progress: 1, step: "", warnings: [],
    options: { count: 3, maxSec: 45, captions: true }, clips: [mk("clip-1", { publish: { status: "done", videoId: "vid00000001", at: "" } }), mk("clip-2"), mk("clip-2-v2", { variantOf: "clip-2" })] };
  const recs = syncRecords([job], {});
  assert.deepEqual(recs.vid00000001.feat, { chat: 0.9 });
  assert.equal(learnProblem({ v: 1, warnings: [], clips: recs }), "");
  assert.equal(learnProblem({ v: 1, warnings: [], clips: { vid00000001: { ...recs.vid00000001, feat: { chat: "x" } } } }), "bad features vid00000001");
  const cv = creatorVirality([job]);
  assert.deepEqual(cv.get("kaicenat"), { avg: 80, n: 2 }); // the variant doesn't count twice
  const pick = (channel: string) => ({ videoId: `id${channel}`.padEnd(11, "x").slice(0, 11), url: "https://youtube.com", title: "stream", channel, channelId: "c", publishedAt: new Date(0).toISOString(), durationSec: 3600,
    stats: { views: 1, likes: 0, comments: 0 }, score: 50, reason: "", source: "watchlist" as const, status: "new" as const });
  const r = rankCandidates([pick("Kai Cenat"), pick("Other")], undefined, 0, new Set(), cv);
  assert.equal(r[0].channel, "Kai Cenat");
  assert.ok(r[0].apScore > r[1].apScore && r[0].why.some((w) => /score 80\/100 on average \(2 clips\)/.test(w)));
});
