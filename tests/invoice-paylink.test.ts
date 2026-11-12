import { test } from "node:test";
import assert from "node:assert/strict";
import { editInvoice, saveStripeLink, newInvoice, parsePayUrl, parseSeller, reminderDraft, setPayUrl, setStatus, stripePayLink, invoicePdf, type Invoice, type Seller } from "../src/lib/invoices-pure.ts";

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
  assert.ok(typeof r === "object" && /STRIPE_SECRET_KEY/.test(r.error));
  assert.equal(called, 0);
});

test("Stripe link: gross cents, EUR, invoice number as product; key only in the header", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return Response.json({ url: "https://buy.stripe.com/test_123" }); }) as unknown as typeof fetch;
  const r = await stripePayLink(sent, "sk_live_SECRET", f);
  assert.deepEqual(r, { url: "https://buy.stripe.com/test_123", gross: 62000 });
  const h = seen!.init.headers as Record<string, string>;
  assert.equal(h["idempotency-key"], `orbit-inv-${sent.id}-62000`);
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
  assert.ok(typeof bad === "object" && !bad.error.includes("SECRET"));
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
  assert.equal(typeof saveStripeLink(sent, { url: "https://buy.stripe.com/x", gross: 1 }, NOW), "string");
  assert.equal((saveStripeLink(sent, { url: "https://buy.stripe.com/x", gross: 62000 }, NOW) as Invoice).payUrl, "https://buy.stripe.com/x");
});
