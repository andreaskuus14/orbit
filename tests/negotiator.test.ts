import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addReply, amountsIn, applyApproval, approveProblem, classifyReply, editDraft, makeDraft, newNegotiation, outsideLimits, parseLimits, planNext, refSide, replan, waiting,
  type Limits, type Negotiation, type Plan,
} from "../src/lib/negotiator-pure.ts";

const T = "2026-10-26T10:00:00.000Z", NOW = Date.parse(T);
const P = "prospect:0b9c2f4e-1d2a-4c3b-8e5f-6a7b8c9d0e1f";
const lim = (o: Record<string, unknown> = {}) => parseLimits({ floor: 400, ceiling: 500, ...o }) as Limits;
const sell = (o: Record<string, unknown> = {}) => newNegotiation("n1", P, "Cake Shop", lim(o), NOW) as Negotiation;
const buy = () => newNegotiation("n2", "offer:o1a2b3c4d", "RTX 4070", lim({ floor: 300, ceiling: 360 }), NOW) as Negotiation;
const reply = (n: Negotiation, t: string, intent?: string) => addReply(n, t, NOW, intent) as { n: Negotiation; plan: Plan };
/** Approve a draft that states exactly the plan's price. */
const say = (n: Negotiation, plan: Plan) => {
  const d = makeDraft(plan.price === null ? "Thanks for your time." : `I can do €${plan.price}.`, plan, "counter", n.limits, NOW);
  assert.equal(typeof d, "object", String(d));
  return applyApproval({ ...n, draft: d as never }, "copy", NOW);
};

test("parseLimits validates the form", () => {
  assert.deepEqual(lim({ mustHaves: "30-day pilot; cancel any time", deadline: "2026-11-30", walkAway: "under 400 it's not worth it" }),
    { floor: 400, ceiling: 500, deadline: "2026-11-30", mustHaves: ["30-day pilot", "cancel any time"], walkAway: "under 400 it's not worth it", stepPct: 5 });
  assert.match(parseLimits({ floor: 0, ceiling: 5 }) as string, /Floor/);
  assert.match(parseLimits({ floor: 500, ceiling: 400 }) as string, /Ceiling/);
  assert.match(parseLimits({ floor: 1, ceiling: 2, deadline: "soon" }) as string, /Deadline/);
  assert.match(parseLimits({ floor: 1, ceiling: 2, stepPct: 50 }) as string, /1–25/);
  assert.equal((parseLimits({ floor: "12,50", ceiling: "€20" }) as Limits).floor, 12.5);
});

test("refSide: prospects sell, deal offers buy, anything else refused", () => {
  assert.equal(refSide(P), "sell");
  assert.equal(refSide("offer:o1a2b3c4d"), "buy");
  assert.equal(refSide("prospect:../../x"), null);
  assert.equal(refSide(42), null);
});

test("amountsIn reads money, not days, percents, specs or years", () => {
  assert.deepEqual(amountsIn("€450 a month, or 430 EUR"), [450, 430]);
  assert.deepEqual(amountsIn("1 500 € or 1.200,50 eur"), [1500, 1200.5]);
  assert.deepEqual(amountsIn("30 days free, 5% off, 12 GB, in 2026, 2 options"), []);
  assert.deepEqual(amountsIn("can do 2k"), [2000]);
  assert.deepEqual(amountsIn("отдам за 320"), [320]);
});

test("classifyReply: no, counter, objection, interested in three languages", () => {
  assert.deepEqual(classifyReply("Thanks, but not interested."), { intent: "no", price: null });
  assert.equal(classifyReply("Ei ole huvitatud, aitäh").intent, "no");
  assert.equal(classifyReply("Уже продан").intent, "no");
  assert.deepEqual(classifyReply("Could you do 420 instead?"), { intent: "counter", price: 420 });
  assert.deepEqual(classifyReply("Pakun 330 eurot"), { intent: "counter", price: 330 });
  assert.equal(classifyReply("Sounds good but it's too expensive for us").intent, "objection");
  assert.equal(classifyReply("Liiga kallis meie jaoks").intent, "objection");
  assert.equal(classifyReply("Sounds interesting, tell me more!").intent, "interested");
});

test("sell: anchors at the ceiling, concedes at most one step, never under the floor, then walks", () => {
  let { n, plan } = reply(sell(), "Interesting, what would it cost?");
  assert.deepEqual([plan.action, plan.price], ["offer", 500]);
  assert.match(plan.strategy, /anchor at €500, concede 5% max/);
  n = say(n, plan);
  ({ n, plan } = reply(n, "How about 300?"));
  assert.deepEqual([plan.action, plan.price], ["offer", 475]);
  assert.match(plan.strategy, /€500 → €475 \(5%\)/);
  n = say(n, plan);
  for (const expect of [450, 425, 400]) { ({ n, plan } = reply(n, "We can do 300.")); assert.equal(plan.price, expect); n = say(n, plan); }
  ({ n, plan } = reply(n, "300 is our final."));
  assert.deepEqual([plan.action, plan.price], ["hold", 400]); // first counter past the floor once he's at it: hold
  n = say(n, plan);
  ({ n, plan } = reply(n, "Still 300."));
  assert.equal(plan.action, "walk"); // the second one: walk
  assert.equal(plan.price, null);
  n = say(n, plan);
  assert.equal(n.state, "walked");
  assert.equal(typeof addReply(n, "ok 400 then", NOW), "string"); // closed
});

test("sell: holds at the floor once before walking; accepts a counter within one step", () => {
  let n = sell({ floor: 480 });
  let r = reply(n, "price?"); n = say(r.n, r.plan); // 500
  r = reply(n, "Can you do 470?"); assert.deepEqual([r.plan.action, r.plan.price], ["offer", 480]); n = say(r.n, r.plan); // step 25 capped at floor
  r = reply(n, "470 is the best we can do"); assert.deepEqual([r.plan.action, r.plan.price], ["hold", 480]); n = say(r.n, r.plan);
  r = reply(sell(), "price?"); n = say(r.n, r.plan);
  r = reply(n, "We could do 490"); assert.deepEqual([r.plan.action, r.plan.price, r.plan.state], ["accept", 490, "agreed"]);
  n = say(r.n, r.plan); assert.equal(n.state, "agreed");
});

test("buy: anchors at the floor and climbs toward the ceiling only", () => {
  let r = reply(buy(), "Hi, yes it's available");
  assert.deepEqual([r.plan.action, r.plan.price], ["offer", 300]);
  let n = say(r.n, r.plan);
  r = reply(n, "Lowest is 380"); assert.deepEqual([r.plan.action, r.plan.price], ["offer", 315]); n = say(r.n, r.plan);
  r = reply(n, "Ok, 320 final"); assert.deepEqual([r.plan.action, r.plan.price], ["accept", 320]);
});

test("objection holds, no closes, deadline expires: never a new price", () => {
  let r = reply(sell(), "price?"); const n = say(r.n, r.plan);
  r = reply(n, "Hmm, that's expensive"); assert.deepEqual([r.plan.action, r.plan.price], ["hold", 500]);
  r = reply(n, "No thanks"); assert.deepEqual([r.plan.action, r.plan.price, r.plan.state], ["close", null, "lost"]);
  const late = { ...n, limits: { ...n.limits, deadline: "2026-10-01" } };
  r = reply(late, "Could you do 450?"); assert.deepEqual([r.plan.action, r.plan.price, r.plan.state], ["close", null, "expired"]);
  assert.equal((replan(r.n, NOW, "objection") as Plan).state, "expired");
});

test("property: no plan ever prices outside the limits", () => {
  for (const side of ["sell", "buy"] as const) for (let seed = 1; seed < 200; seed++) {
    let n = side === "sell" ? sell({ stepPct: 1 + (seed % 25) }) : buy();
    for (let i = 0; i < 12 && n.state === "talking"; i++) {
      const theirs = Math.round(Math.abs(Math.sin(seed * 31 + i)) * 900);
      const r = reply(n, i % 4 === 3 ? "too expensive" : `${theirs} eur?`);
      if (r.plan.price !== null) assert.ok(r.plan.price >= n.limits.floor && r.plan.price <= n.limits.ceiling, `${side} ${seed} ${r.plan.price}`);
      n = say(r.n, r.plan);
    }
  }
});

test("makeDraft refuses CORE words outside the limits or missing the planned price", () => {
  const plan: Plan = { action: "offer", price: 475, strategy: "s", state: "talking" };
  assert.match(makeDraft("I can do €350.", plan, "counter", lim(), NOW) as string, /€350, outside your limits/);
  assert.match(makeDraft("I can do €450 instead.", plan, "counter", lim(), NOW) as string, /didn't state the planned €475/);
  assert.match(makeDraft("  ", plan, "counter", lim(), NOW) as string, /empty/);
  const d = makeDraft("€475 a month, 30 days free to start.", plan, "counter", lim(), NOW);
  assert.equal(typeof d === "object" && d.price, 475);
  assert.deepEqual(outsideLimits("€475 or €520", lim()), ["€520"]);
});

test("his edit outside the limits needs his explicit confirm; approval checks the version he read", () => {
  const plan: Plan = { action: "offer", price: 475, strategy: "s", state: "talking" };
  const n = { ...sell(), draft: makeDraft("€475 works.", plan, "counter", lim(), NOW) as never } as Negotiation;
  assert.match(editDraft(n, "Fine, €350.", false, NOW) as string, /Outside your limits: €350.*I mean it/);
  const ok = editDraft(n, "Fine, €350.", true, NOW + 1000);
  assert.ok(typeof ok === "object" && ok.override && ok.price === 350);
  const edited = { ...n, draft: ok as never } as Negotiation;
  assert.equal(approveProblem(edited, n.draft!.at), "The draft changed since you read it: reload");
  assert.equal(approveProblem(edited, (ok as { at: string }).at), "");
  assert.match(approveProblem({ ...edited, draft: { ...edited.draft!, override: undefined } }, edited.draft!.at), /Outside your limits/);
  assert.equal(approveProblem(undefined, "x"), "Not found");
  assert.deepEqual(waiting([edited, sell()]).map((x) => x.id), ["n1"]);
  const after = applyApproval(edited, "email", NOW);
  assert.deepEqual([after.draft, after.turns.at(-1)?.price, after.turns.at(-1)?.via], [null, 350, "email"]);
});
