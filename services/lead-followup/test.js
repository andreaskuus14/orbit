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
const { validateLead, newLead, telegramUpdate } = await import('./server.js');

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
const tap = (data, chat = 42) => telegramUpdate({ callback_query: { id: 'q', data, message: { chat: { id: chat } } } });

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
  assert.equal(db()[id].status, 'pending');
  await tap(`r:${id}`);
  await tap(`a:${id}`);
  assert.equal(db()[id].status, 'rejected');
  assert.ok(!calls.some((c) => c.url.includes('resend')));
});

test('failed email is recorded, not retried', async () => {
  await newLead({ name: 'Mari', email: 'mari@example.com', message: 'Hi' });
  const id = Object.keys(db())[0];
  globalThis.fetch = async (url, opts) => (url.includes('resend')
    ? { ok: false, text: async () => 'boom' }
    : { ok: true, json: async () => ({ ok: true }) });
  await tap(`a:${id}`);
  assert.equal(db()[id].status, 'failed');
});
