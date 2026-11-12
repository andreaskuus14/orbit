// IO glue (invoices.ts): a failed Stripe switch-off never undoes his change; it is logged ok:false and returned as a warning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { register } from "node:module";

const SRC = new URL("../src/", import.meta.url).href;
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, next) {
  if (s.startsWith("@/")) s = ${JSON.stringify(SRC)} + s.slice(2);
  try { return await next(s, c); } catch (e) { if ((s.startsWith(".") || s.startsWith("file:")) && !/\\.[a-z]+$/.test(s)) return next(s + ".ts", c); throw e; } }`));

const DIR = (process.env.ORBIT_DATA_DIR = await mkdtemp(path.join(tmpdir(), "orbit-paylink-io-")));
process.env.STRIPE_SECRET_KEY = "sk_live_TEST";
const { deleteDraft, changeStatus, makeStripeLink } = await import("../src/lib/invoices.ts");
const logged: unknown[] = [];
const sb = { from: () => ({ insert: async (row: unknown) => { logged.push(row); return { error: null }; } }) } as never;
const boom = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
const inv = (id: string, status: string) => ({ id, number: id, status, payLinkId: "plink_" + id, payUrl: "https://buy.stripe.com/" + id, buyer: { name: "B", email: "" }, lines: [{ text: "x", cents: 100 }], vat: { on: false, rate: 24 }, issued: "2026-11-01", due: "2026-11-15", sentAt: "2026-11-01T00:00:00Z", paidAt: null, notes: "", updated: "2026-11-01T00:00:00Z" });
const store = () => readFile(path.join(DIR, "invoices.json"), "utf8").then((t) => JSON.parse(t) as { invoices: { id: string; status: string; payLinkId?: string }[] });
console.warn = () => {};

test("throwing switch-off: draft still deleted, paid still saved, ok:false logged and warned", async () => {
  await writeFile(path.join(DIR, "invoices.json"), JSON.stringify({ seller: null, invoices: [inv("d1", "draft"), inv("s1", "sent")] }));
  const [r, warn] = await deleteDraft(sb, "u", "d1", boom);
  assert.equal(r, "");
  assert.match(warn, /may still be live/);
  const [p, warn2] = await changeStatus(sb, "u", { id: "s1", to: "paid", paidOn: "2026-11-10" }, boom);
  assert.equal(typeof p, "object");
  assert.match(warn2, /may still be live/);
  const s = await store();
  assert.deepEqual(s.invoices.map((i) => [i.id, i.status, i.payLinkId]), [["s1", "paid", undefined]]);
  await new Promise((r) => setTimeout(r, 20)); // emit is fire-and-forget
  assert.ok(JSON.stringify(logged).includes('"ok":false'), JSON.stringify(logged));
});

test("refused save (marked paid while the link was made): paid kept, new link switch-off tried, failure warned", async () => {
  await writeFile(path.join(DIR, "invoices.json"), JSON.stringify({ seller: null, invoices: [{ ...inv("s2", "sent"), payLinkId: undefined, payUrl: undefined }] }));
  logged.length = 0;
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    if (url.endsWith("/payment_links")) { // he marks it paid in another tab meanwhile
      const s = await store(); s.invoices[0].status = "paid"; await writeFile(path.join(DIR, "invoices.json"), JSON.stringify(s));
      return Response.json({ url: "https://buy.stripe.com/new", id: "plink_new" });
    }
    return new Response("{}", { status: 500 });
  }) as unknown as typeof fetch;
  const [r, warn] = await makeStripeLink(sb, "u", { id: "s2" }, f);
  assert.equal(r, "This invoice is already paid");
  assert.match(warn, /new Stripe link may still be live/);
  assert.deepEqual(calls, ["https://api.stripe.com/v1/payment_links", "https://api.stripe.com/v1/payment_links/plink_new"]);
  const s = await store();
  assert.equal(s.invoices[0].status, "paid");
  assert.equal(s.invoices[0].payLinkId, undefined);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(JSON.stringify(logged).includes('"ok":false'));
});
