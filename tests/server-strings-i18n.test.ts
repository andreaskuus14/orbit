import { test } from "node:test";
import assert from "node:assert/strict";
import { tx } from "../src/lib/i18n-pure.ts";
import { check, headlineOf } from "../src/lib/doctor-pure.ts";
import { incidentTitle, problems } from "../src/lib/system-health-pure.ts";
import { stoppedText } from "../src/lib/night-pure.ts";
import { NOUN } from "../src/lib/night-learn-pure.ts";
import { describeAction, describeTrigger } from "../src/lib/rules-pure.ts";

test("tx: Estonian by stable id, else the server's English", () => {
  assert.equal(tx("et", "check.disk", "Free disk space"), "Vaba kettaruum");
  assert.equal(tx("en", "check.disk", "Free disk space"), "Free disk space");
  assert.equal(tx("et", "check.newthing", "New thing"), "New thing");
});

test("doctor headline renders in either language from the checks", () => {
  const cs = [check("a", "A", "fail", "x"), check("b", "B", "warn", "y"), check("c", "C", "warn", "z")];
  assert.equal(headlineOf(cs), "1 problem and 2 warnings out of 3 checks.");
  assert.equal(headlineOf(cs, "et"), "1 probleem ja 2 hoiatust 3 kontrollist.");
  assert.equal(headlineOf([check("a", "A", "ok", "x"), check("b", "B", "ok", "x")], "et"), "Kõik töötab (2 kontrolli).");
});

test("incident titles: English stays as stored, Estonian rebuilt from the key", () => {
  const ps = problems([{ id: "supabase", label: "Database (Supabase)", state: "down", detail: "", lastOk: null }],
    [{ id: "vault", label: "VAULT", dir: "x", free: 1, status: "fail" }], 1);
  assert.deepEqual(ps.map((p) => p.title), ["Database (Supabase) is down", "VAULT: disk almost full", "Claude usage limit reached"]);
  assert.deepEqual(ps.map((p) => incidentTitle(p, "et")), ["Andmebaas (Supabase) on maas", "VAULT: ketas on peaaegu täis", "Claude'i kasutuslimiit on täis"]);
  assert.equal(incidentTitle({ key: "svc:new", title: "New svc is down" }, "et"), "New svc on maas");
  assert.equal(incidentTitle({ key: "odd", title: "Odd" }, "et"), "Odd");
});

test("night stop reasons and learned-kind nouns", () => {
  assert.equal(stoppedText("budget"), "Tonight's budget was used up");
  assert.equal(stoppedText("window", "et"), "Öine ajaaken sai läbi");
  assert.equal(stoppedText("something else", "et"), "something else");
  assert.equal(stoppedText(), "");
  assert.equal(NOUN.clips, "Shorts packaging");
});

test("rule descriptions in English (unchanged) and Estonian", () => {
  const sched = (days: number[]) => ({ type: "schedule" as const, schedule: { days, hour: 7, minute: 5 } });
  assert.equal(describeTrigger(sched([1, 3])), "Every Monday and Wednesday at 07:05");
  assert.equal(describeTrigger(sched([1, 2, 3, 4, 5]), "et"), "Igal tööpäeval kell 07:05");
  assert.equal(describeTrigger(sched([1, 5]), "et"), "Igal esmaspäeval ja reedel kell 07:05");
  assert.equal(describeTrigger({ type: "event", event: "client.replied" }, "et"), "Kui klient vastab");
  assert.equal(describeAction({ kind: "skill", name: "seo", input: "x" }), "Run skill “seo”: x");
  assert.equal(describeAction({ kind: "orbit", id: "deals" }, "et"), "Vaata üle pakkumiste jahtija soovinimekiri");
  assert.equal(describeAction({ kind: "mission", objective: "Ship" }, "et"), "Missioon: Ship");
});
