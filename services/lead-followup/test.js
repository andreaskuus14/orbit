// Self-check with fake Claude/Telegram/Resend. Run: node --test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

Object.assign(process.env, {
  DB_FILE: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lf-')), 'leads.json'),
  TELEGRAM_CHAT_ID: '42', FROM_EMAIL: 'shop@example.com', BUSINESS_NAME: 'Test Bakery',
});
const { validateLead, newLead, telegramUpdate, allowLead, approvalText, foreignContacts, mailOutcome, idempotencyKey } = await import('./server.js');

let calls;
beforeEach(() => {
  calls = [];
  fs.rmSync(process.env.DB_FILE, { force: true });
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    const json = url.includes('anthropic') ? { content: [{ type: 'text', text: 'Hi! Yes we can.' }] } : { ok: true };
    return { ok: true, json: async () => json, text: async () => '' };
  };
});
const db = () => JSON.parse(fs.readFileSync(process.env.DB_FILE, 'utf8'));
const tap = (data, chat = 42, from = chat) => telegramUpdate({ callback_query: { id: 'q', data, from: { id: from }, message: { chat: { id: chat } } } });

test('rejects bad input', () => {
  assert.equal(validateLead({ name: 'A', email: 'nope', message: 'hi' }), null);
  assert.equal(validateLead({}), null);
  assert.equal(validateLead({ name: 'A', email: 'a@b.co', message: 'x'.repeat(5000) }).message.length, 2000);
});

test('new lead drafts and asks owner, sends nothing to customer', async () => {
  const r = await newLead({ name: 'Mari', email: 'mari@example.com', message: 'Do you bake gluten-free?' });
  assert.equal(r.status, 200);
  assert.ok(calls.some((c) => c.url.includes('sendMessage')));
  assert.ok(!calls.some((c) => c.url.includes('resend')));
  const lead = Object.values(db())[0];
  assert.equal(lead.status, 'pending');
  assert.match(lead.draft, /AI assistant/);
});

test('approve sends exactly once, even on double tap', async () => {
  await newLead({ name: 'Mari', email: 'mari@example.com', message: 'Hi' });
  const id = Object.keys(db())[0];
  await tap(`a:${id}`);
  await tap(`a:${id}`);
  const sends = calls.filter((c) => c.url.includes('resend'));
  assert.equal(sends.length, 1);
  assert.equal(sends[0].body.to, 'mari@example.com');
  assert.equal(db()[id].status, 'sent');
});

test('reject and foreign chats never send', async () => {
  await newLead({ name: 'Mari', email: 'mari@example.com', message: 'Hi' });
  const id = Object.keys(db())[0];
  await tap(`a:${id}`, 999); // someone else's chat
  await tap(`a:${id}`, 42, 777); // someone else tapping in the owner's chat (a group)
  assert.equal(db()[id].status, 'pending');
  await tap(`r:${id}`);
  await tap(`a:${id}`);
  assert.equal(db()[id].status, 'rejected');
  assert.ok(!calls.some((c) => c.url.includes('resend')));
});

// Resend answers with `reply` (a status number, or a thrown error for no answer); Telegram notes are collected.
let ipN = 0;
async function approveWith(reply) {
  await newLead({ name: 'Mari', email: 'mari@example.com', message: 'Hi' }, `6.6.6.${ipN++}`); // own IP each: the form is rate-limited
  const id = Object.keys(db())[0];
  const sends = [], notes = [];
  globalThis.fetch = async (url, opts) => {
    if (url.includes('answerCallbackQuery')) notes.push(JSON.parse(opts.body).text);
    if (!url.includes('resend')) return { ok: true, json: async () => ({ ok: true }) };
    sends.push(opts.headers);
    if (reply instanceof Error) throw reply;
    return { ok: reply < 300, status: reply, json: async () => ({ id: 'em_1' }) };
  };
  await tap(`a:${id}`);
  await tap(`a:${id}`); // a later tap must not resend
  return { id, lead: db()[id], sends, notes };
}

test('a clear refusal (422) is failed, not retried', async () => {
  const { lead, sends, notes } = await approveWith(422);
  assert.equal(lead.status, 'failed');
  assert.equal(sends.length, 1);
  assert.match(notes[0], /reply manually/);
});

for (const [name, reply] of [['timeout', Object.assign(new Error('aborted'), { name: 'TimeoutError' })], ['409', 409], ['429', 429], ['500', 500]]) {
  test(`${name} means the email may have gone out: unknown, honest note, never resent`, async () => {
    const { lead, sends, notes } = await approveWith(reply);
    assert.equal(lead.status, 'unknown');
    assert.equal(sends.length, 1);
    assert.match(notes[0], /may or may not have been sent.*Resend log/i);
  });
}

test('200 is sent, with a stable idempotency key per approved reply', async () => {
  const { id, lead, sends } = await approveWith(200);
  assert.equal(lead.status, 'sent');
  const key = sends[0]['idempotency-key'];
  assert.ok(key?.startsWith(`lead-${id}-`));
  assert.equal(idempotencyKey(id, lead.draft), key, 'a retry of the same approved item reuses the key');
  assert.notEqual(idempotencyKey(id, lead.draft + ' edited'), key, 'a new text version gets a new key');
  assert.deepEqual([200, 202, undefined, 409, 429, 503, 400, 422].map(mailOutcome), ['sent', 'sent', 'unknown', 'unknown', 'unknown', 'unknown', 'failed', 'failed']);
});

test('rate limits: 5 per IP per hour, then a daily cap', () => {
  const t = Date.parse('2030-01-01T10:00:00Z');
  for (let i = 0; i < 5; i++) assert.equal(allowLead('1.2.3.4', t + i), true);
  assert.equal(allowLead('1.2.3.4', t + 10), false);
  assert.equal(allowLead('1.2.3.4', t + 3_600_001), true, 'the hour window slides');
  let ok = 0;
  for (let i = 0; i < 300; i++) if (allowLead(`9.9.${i}.1`, t + 20)) ok++;
  assert.ok(ok < 300, 'daily cap stops a botnet');
});

test('approval message fits Telegram and warns about smuggled links', () => {
  const lead = { name: 'A', email: 'a@b.co', message: 'x'.repeat(2000) };
  assert.ok(approvalText('id', lead, 'y'.repeat(3000)).length <= 4096);
  assert.match(approvalText('id', lead, 'Pay here: https://evil.example/pay'), /^⚠/);
  assert.deepEqual(foreignContacts('Call +372 5555 1234 or see https://shop.ee', 'Phone +372 5555 1234, site https://shop.ee'), []);
});

test('API errors never contain the request URL (it holds the Telegram token)', async () => {
  globalThis.fetch = async () => ({ ok: false, text: async () => 'bad' });
  process.env.TELEGRAM_BOT_TOKEN = 'SECRET123';
  await assert.rejects(newLead({ name: 'M', email: 'm@example.com', message: 'Hi' }, '5.5.5.5'), (e) => !String(e.message).includes('SECRET123'));
});

test('a lead that arrives while an email is sending is kept', async () => {
  fs.rmSync(process.env.DB_FILE, { force: true });
  globalThis.fetch = async (url) => ({ ok: true, json: async () => (url.includes('anthropic') ? { content: [{ type: 'text', text: 'Hi' }] } : { ok: true }), text: async () => '' });
  await newLead({ name: 'A', email: 'a@example.com', message: 'first' }, '7.7.7.1');
  const first = Object.keys(db())[0];
  let release;
  const slow = globalThis.fetch;
  globalThis.fetch = (url, o) => (url.includes('resend') ? new Promise((r) => { release = () => r({ ok: true, json: async () => ({}) }); }) : slow(url, o));
  const sending = tap(`a:${first}`);
  await new Promise((r) => setTimeout(r, 0));
  await newLead({ name: 'B', email: 'b@example.com', message: 'second' }, '7.7.7.2');
  release(); await sending;
  assert.equal(Object.keys(db()).length, 2);
  assert.equal(db()[first].status, 'sent');
});

test('dates are not mistaken for phone numbers', () => {
  assert.deepEqual(foreignContacts('See you on 2026-10-20 at 10:00', ''), []);
});
