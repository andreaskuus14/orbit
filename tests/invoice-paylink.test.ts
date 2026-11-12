import { test } from "node:test";
import assert from "node:assert/strict";
import { deactivateStripeLink, linkToRetire, editInvoice, saveStripeLink, newInvoice, parsePayUrl, parseSeller, reminderDraft, setPayUrl, setStatus, stripePayLink, invoicePdf, type Invoice, type Seller } from "../src/lib/invoices-pure.ts";

const NOW = Date.parse("2026-10-26T10:00:00.000Z");
const seller = parseSeller({ name: "Andreas OÜ", regCode: "12345678", vatNo: "EE123456789", address: "Tartu mnt 1, Tallinn", iban: "EE38 2200 2210 2014 5685", email: "a@example.com" }) as Seller;
const draft = newInvoice("i1", { source: { kind: "prospect", id: "p1", label: "Cake" }, buyer: { name: "Cake", email: "c@shop.ee" }, line: { text: "Website", cents: 50000 } }, seller, [], NOW);
const sent = setStatus(draft, "sent", NOW, seller) as Invoice;

test("pay link host allowlist", () => {
  for (const ok of ["https://buy.stripe.com/abc123", "https://checkout.stripe.com/c/pay/x", "https://paypal.me/andreas/500", "https://www.paypal.com/paypalme/a"]) assert.equal(typeof parsePayUrl(ok), "string", ok);
  for (const bad of ["http://buy.stripe.com/a", "https://buy.stripe.com.evil.ee/a", "https://evil.ee/buy.stripe.com", "https://u:p@paypal.me/a", "https://paypal.me:8443/a", "javascript:alert(1)", "nope"]) assert.equal(typeof parsePayUrl(bad), "object", bad);
  assert.equal(parsePayUrl(""), "");
  const s = setPayUrl(sent, "https://buy.stripe.com/abc", NOW) as Invoice;
  assert.equal(s.payUrl, "https://buy.stripe.com/abc");
  assert.equal((setPayUrl(s, "", NOW) as Invoice).payUrl, undefined);
  assert.equal(typeof setPayUrl({ ...sent, status: "paid" }, "https://buy.stripe.com/abc", NOW), "string");
});

test("no Stripe key ⇒ refusal, fetch never called", async () => {
  let called = 0;
  const r = await stripePayLink(sent, undefined, (async () => { called++; return new Response("{}"); }) as typeof fetch);
  assert.ok("error" in r && /STRIPE_SECRET_KEY/.test(r.error));
  assert.equal(called, 0);
});

test("Stripe link: gross cents, EUR, invoice number as product; key only in the header", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return Response.json({ url: "https://buy.stripe.com/test_123", id: "plink_1" }); }) as unknown as typeof fetch;
  const r = await stripePayLink(sent, "sk_live_SECRET", f);
  assert.deepEqual(r, { url: "https://buy.stripe.com/test_123", gross: 62000, id: "plink_1" });
  const h = seen!.init.headers as Record<string, string>;
  assert.equal(h["idempotency-key"], `orbit-inv-${sent.id}-62000-${sent.updated}`);
  assert.match(h["stripe-version"], /^\d{4}-\d{2}-\d{2}\./);
  const body = new URLSearchParams(String(seen!.init.body));
  assert.equal(seen!.url, "https://api.stripe.com/v1/payment_links");
  assert.equal(body.get("line_items[0][price_data][currency]"), "eur");
  assert.equal(body.get("line_items[0][price_data][unit_amount]"), "62000"); // €500 + 24% VAT
  assert.equal(body.get("line_items[0][price_data][product_data][name]"), `Invoice ${sent.number}`);
  assert.equal(body.get("line_items[0][quantity]"), "1");
  assert.equal(body.get("restrictions[completed_sessions][limit]"), "1");
  assert.ok(!String(seen!.init.body).includes("SECRET"));
  const bad = await stripePayLink(sent, "sk_live_SECRET", (async () => Response.json({ error: { message: "Invalid API Key" } }, { status: 401 })) as typeof fetch);
  assert.ok("error" in bad && !bad.error.includes("SECRET"));
  const evil = await stripePayLink(sent, "sk_live_SECRET", (async () => Response.json({ url: "https://evil.ee/x" })) as typeof fetch);
  assert.equal(typeof evil, "object");
});

test("pay link appears in drafted reminders and the PDF", () => {
  const i = { ...(setPayUrl(sent, "https://buy.stripe.com/abc", NOW) as Invoice), due: "2026-10-01" };
  for (const lang of ["English", "Estonian"]) assert.match((reminderDraft(i, seller, lang, "2026-10-26", NOW) as { text: string }).text, /https:\/\/buy\.stripe\.com\/abc/);
  assert.doesNotMatch((reminderDraft({ ...sent, due: "2026-10-01" }, seller, "English", "2026-10-26", NOW) as { text: string }).text, /stripe/);
  assert.match(new TextDecoder("latin1").decode(invoicePdf(i, seller)), /buy\.stripe\.com/);
});

test("test-mode key is refused before any call", async () => {
  let called = 0;
  const r = await stripePayLink(sent, "sk_test_x", (async () => { called++; return new Response("{}"); }) as typeof fetch);
  assert.ok(typeof r === "object" && "error" in r && /live/.test(r.error));
  assert.equal(called, 0);
});

test("link never charges a different amount than the invoice", () => {
  const d = setPayUrl(draft, "https://buy.stripe.com/abc", NOW) as Invoice;
  assert.equal((editInvoice(d, { notes: "hi" }, NOW) as Invoice).payUrl, "https://buy.stripe.com/abc");
  assert.equal((editInvoice(d, { lines: [{ text: "Website", qty: 2, price: "500" }] }, NOW) as Invoice).payUrl, undefined);
  assert.equal(typeof saveStripeLink(sent, { url: "https://buy.stripe.com/x", gross: 1, id: "plink_x" }, NOW), "string");
  assert.equal((saveStripeLink(sent, { url: "https://buy.stripe.com/x", gross: 62000, id: "plink_x" }, NOW) as Invoice).payUrl, "https://buy.stripe.com/x");
});

const fake = () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return Response.json({}); }) as unknown as typeof fetch;
  return { calls, f };
};
const withLink = saveStripeLink(sent, { url: "https://buy.stripe.com/x", gross: 62000, id: "plink_A1" }, NOW) as Invoice;

test("switch-off: POST active=false on that link, pinned version, live key only, key never in errors", async () => {
  const { calls, f } = fake();
  assert.equal(await deactivateStripeLink("plink_A1", "sk_live_SECRET", f), "");
  assert.equal(calls[0].url, "https://api.stripe.com/v1/payment_links/plink_A1");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(new URLSearchParams(String(calls[0].init.body)).get("active"), "false");
  assert.equal((calls[0].init.headers as Record<string, string>)["stripe-version"], "2025-09-30.clover");
  for (const [id, key] of [["plink_A1", "sk_test_x"], ["plink_A1", undefined], ["../customers", "sk_live_SECRET"]] as const) assert.notEqual(await deactivateStripeLink(id, key, f), "");
  assert.equal(calls.length, 1);
  const down = await deactivateStripeLink("plink_A1", "sk_live_SECRET", (async () => { throw new Error("sk_live_SECRET"); }) as typeof fetch);
  assert.ok(down && !down.includes("SECRET"));
  assert.match(await deactivateStripeLink("plink_A1", "sk_live_SECRET", (async () => new Response("{}", { status: 500 })) as typeof fetch), /500/);
});

test("which link a change orphans", () => {
  assert.equal(withLink.payLinkId, "plink_A1");
  assert.equal(linkToRetire(withLink, setStatus(withLink, "paid", NOW, seller)), "plink_A1"); // (c) marked paid by him
  assert.equal((setStatus(withLink, "paid", NOW, seller) as Invoice).payUrl, undefined);
  const d = { ...draft, payUrl: "https://buy.stripe.com/x", payLinkId: "plink_A1" };
  assert.equal(linkToRetire(d, editInvoice(d, { lines: [{ text: "Website", qty: 2, price: "500" }] }, NOW)), "plink_A1"); // (b) total changed
  assert.equal(linkToRetire(d, editInvoice(d, { notes: "hi" }, NOW)), null);
  assert.equal(linkToRetire(withLink, setPayUrl(withLink, "https://paypal.me/a", NOW)), "plink_A1"); // replaced by a pasted link
  assert.equal(linkToRetire(withLink, "refused"), null);
  assert.equal(linkToRetire(sent, setStatus(sent, "paid", NOW, seller)), null);
});

test("(a) a refused save leaves the new link to switch off, and a retry asks Stripe for a fresh one", async () => {
  const keys: string[] = [];
  const f = (async (_u: string, init: RequestInit) => { keys.push((init.headers as Record<string, string>)["idempotency-key"]); return Response.json({ url: "https://buy.stripe.com/n", id: "plink_N" }); }) as unknown as typeof fetch;
  const link = await stripePayLink(sent, "sk_live_x", f) as { id: string; gross: number; url: string };
  assert.equal(typeof saveStripeLink({ ...sent, lines: [{ text: "x", qty: 1, cents: 1 }] }, link, NOW), "string");
  const { calls, f: off } = fake();
  assert.equal(await deactivateStripeLink(link.id, "sk_live_x", off), "");
  assert.equal(calls[0].url, "https://api.stripe.com/v1/payment_links/plink_N");
  await stripePayLink({ ...sent, updated: "2026-10-26T11:00:00.000Z" }, "sk_live_x", f);
  assert.notEqual(keys[0], keys[1]);
});
