# Lead Follow-up Autopilot

Lives next to ORBIT but runs on its own small host (it serves client websites, so it can't depend on your PC). Track the businesses you sell it to on ORBIT's BUSINESS planet.

A customer fills in the website form → Claude drafts a reply in seconds → the business owner gets it in Telegram with **✅ Send / ❌ Reject** → only an approved reply is emailed to the customer.

Why it sells: answering inside 5 minutes converted about 8× better than answering later in a study of 5.7 million leads (XANT/InsideSales, 2021), and most businesses take hours or days.

## What you need (one set per client)

| Thing | Where | Env variable |
|---|---|---|
| Claude API key | console.anthropic.com | `ANTHROPIC_API_KEY` |
| Telegram bot | message @BotFather → `/newbot` | `TELEGRAM_BOT_TOKEN` |
| Owner's chat id | owner messages the bot, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id` | `TELEGRAM_CHAT_ID` |
| Webhook secret | any long random string you make up | `TELEGRAM_SECRET` |
| Email sending | resend.com (verify the client's domain) | `RESEND_API_KEY`, `FROM_EMAIL` |
| Business facts | prices, hours, services, area — plain text | `BUSINESS_NAME`, `BUSINESS_INFO` |

Optional: `REPLY_TO` (owner's inbox), `MODEL` (default `claude-sonnet-5-5`), `PORT`, `DB_FILE`, `ALLOW_ORIGIN` (set to the client's site, e.g. `https://bakery.ee`).

## Run

```bash
npm test          # 5 safety checks, no keys needed
npm start         # needs the env variables above
```

Host it on any small Node host with a public HTTPS URL. Then point Telegram at it once:

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://YOUR-HOST/telegram&secret_token=<TELEGRAM_SECRET>
```

## Put the form on the client's site

```html
<form id="lead">
  <input name="name" placeholder="Name" required>
  <input name="email" type="email" placeholder="Email" required>
  <textarea name="message" placeholder="How can we help?" required></textarea>
  <p><small>We reply fast. Replies are drafted with an AI assistant and checked by our team.</small></p>
  <button>Send</button>
</form>
<script>
lead.onsubmit = async (e) => {
  e.preventDefault();
  const r = await fetch('https://YOUR-HOST/lead', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(lead))) });
  lead.innerHTML = r.ok ? '<p>Thanks! We will reply shortly.</p>' : '<p>Something went wrong — please email us.</p>';
};
</script>
```

## Safety rules built in (don't remove)

- No reply leaves without the owner's tap; a double tap sends once.
- Only the owner's Telegram chat can approve; the webhook checks Telegram's secret header.
- Form input is length-limited and checked; the model only writes the body — the recipient is always the address the customer typed.
- Every reply ends with a line saying it was drafted with an AI assistant (EU AI Act Art. 50).
- A failed send is marked `failed` and you are told to reply by hand; it never retries on its own.

## Legal checklist per client (not legal advice)

- Replying to someone who asked a question is generally fine under GDPR; **marketing** emails to them later need their opt-in. This tool only answers the enquiry.
- Add a line to the client's privacy policy: enquiries are processed by an AI provider (Anthropic) and an email provider (Resend).
- Sign a simple data-processing agreement with each client.

## Not included yet (add when a client asks)

Editing a draft before sending, SMS/WhatsApp, follow-up reminders after 2 days, a dashboard. Data lives in `leads.json` on the server — back it up.
