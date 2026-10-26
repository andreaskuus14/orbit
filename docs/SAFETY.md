# ORBIT safety rules (one page)

What ORBIT may do alone, what always waits for you, and where your data goes. Features: [FEATURES.md](FEATURES.md) · Setup: [SETUP.md](SETUP.md) · Phone: [PHONE.md](PHONE.md)

## 1. The four things that need your click

| Action | Where you approve it | Extra checks |
|--------|----------------------|--------------|
| **Send** an email (BUSINESS draft, negotiation reply, signed contract) | BUSINESS → *Approve & send* (two clicks), the morning brief opens it, or Remote on the phone | Sends only the exact version you read; if it changed, reload. One business is emailed once, even on a double click |
| **Spend** Higgsfield credits | STUDIO → Clip Factory → AI Story *Approve & generate (N credits)*, the Shorts batch button, Remote, or a voice/Shortcut confirm | Only the exact quoted credits; refused past `ORBIT_HIGGSFIELD_WEEKLY_CAP` (default 10/week) |
| **Sign** a contract | BUSINESS → Contracts → *Sign*, on the PC only | No phone, voice or auto path. ORBIT never signs |
| **Publish** a Short | STUDIO review → *Approve*, then schedule | Another creator's clip needs "What I added" first |

Approvals from the phone, a voice call or a Shortcut use the same checks as the PC button: only items already waiting, exactly as shown (a voice "yes" within a minute; a Shortcut needs a one-time 4-digit code and, for a spend, the exact credits). They can't start new sends, spends or jobs. Shortcuts never approve emails (read them in Remote). On a call, ORBIT can send a waiting BUSINESS email after it asks "Send the email to <recipient>, exactly as drafted?" and you say yes, so only say yes to a draft you have already read. Contracts are PC-only.

ORBIT never: buys anything, messages a seller, logs in to other sites, posts comments, deploys a shop, edits your Roblox place or ORBIT's own code. Web access is read-only.

### CORE tools

Every CORE tool call passes one check first (`src/lib/policy-pure.ts`). Tools are tiered: read your data, read the public web, change your own data, act outside. The only "act outside" tools CORE has are *schedule clips you already approved* and *ask Higgsfield for a price* (it can't spend). Writes (save a memory, create a goal, queue tonight, add a wish…) only happen when your latest message asks for them, not because a web page, file or memory told it to. Unknown tools are refused.

## 2. Autonomy levels

Profile → **Autonomy**. Per area, one of:

- **Off**: ORBIT never does it, not even when you click.
- **Ask**: only when you ask or click.
- **Do & report**: ORBIT does it on its own and tells you. Nothing leaves ORBIT without your click.
- **Auto with limits**: acts without your click. Exists **only** for *BUSINESS email* and *Studio: publish*.

Defaults keep today's behaviour: background work (research, morning brief, memory tidy-up, Studio prep, BUSINESS drafts, goals, night shift, deal hunter, calls) is *Do & report*; sending, publishing, Higgsfield and contracts are *Ask*. Higgsfield and contracts can never be Auto.

### The "SEND EMAIL WITHOUT ME" switch

To turn BUSINESS email to Auto you must type **SEND EMAIL WITHOUT ME** (for publishing: **PUBLISH WITHOUT ME**). It also refuses until phone push is set up, so you hear about every action. Then, every time:

- Only drafts made **after** you switched it on, and only to existing BUSINESS prospects (only ORBIT's own clips for publishing).
- A daily cap: 3 emails / 1 Short by default (max 20 / 5).
- Text check: anything with a digit, currency, price, payment, discount, free/trial/pilot, contract, date, deadline or promise ("we will", "guarantee"…, in English, Estonian and Russian) is held for you.
- Each one is queued with a **10-minute cancel window** and a push. A cancelled version is never queued again until you change it.
- Stop-all cancels the queue. Switching the area back from Auto cancels what was waiting.

Turning this on changes AGENTS.md rule 6 for that area; it is your decision only.

## 3. Stop-all

🛑 in the top HUD (with a confirm), "stop everything" by voice (plain "stop" only silences ORBIT), Remote, or the *Stop ORBIT* Shortcut.

When on: running agent tasks, team chains and goal steps are cancelled; the night shift, niche scout, shop builds and deal hunts stop; queued Auto emails/Shorts are cancelled; no new work starts (scheduler, automations, proposals, autopilot, auto-clips); no email, contract or negotiation reply is sent; no credits are spent; ORBIT doesn't call you. A red "Paused" banner shows.
Not stopped: a clip render or YouTube upload already under way finishes (killing it could leave broken files).
Turning it **off** is done on the PC only; the phone and Shortcuts can only turn it on.

## 4. Quiet hours: 23:00–08:00 (Tallinn time)

- Phone pushes: only failures come through (the rest are skipped; Remote still lists them).
- Calls: ORBIT never rings (also max 2 calls a day, an hour apart, and never under Stop-all).
- Auto emails and Shorts: held; their 10-minute cancel window starts at 08:00.
- Windows toasts from the news watcher: none.
- The night shift works inside this time (default 01:00–06:30), but it never sends, publishes or spends.

## 5. Where your data goes

**Stays on the PC**
- Your voice: transcribed by Whisper on the PC and never saved. ORBIT's voice is made on the PC (Kokoro). The "orbital wake up" listener is offline.
- Screenshots from *Look at my screen*: one frame, kept in memory for that one answer, not saved unless you press *Save*.
- ORBIT's local state in `%LOCALAPPDATA%\orbit`: autonomy, Stop-all, lessons, predictions, negotiations, contracts, deals, health notes, paired phones and Shortcut tokens (stored only as signatures, never the token itself).
- Memory search uses a free model on the PC, **unless** `VOYAGE_API_KEY` is set (then memory text goes to Voyage AI; set `ORBIT_EMBED=local` to stop that).

**Never sent to an AI model**
- Journal entries ("Today in a minute"): not mined for beliefs, lessons, episodes or the nightly memory tidy-up, and skipped by CORE's and agents' memory search. Chronicle shows private moments only when you switch them on, and never sends them to a model.
- The only exception is you: if you ask CORE about your journal, it reads it for that answer, and then web search, news and agents are switched off for the rest of that answer.
- Calendar titles and reminders reach the morning brief (and its one daily wording pass) only if you tick *Say calendar titles and reminders aloud*.

**Never in a notification or log**
- Pushes carry only a fixed label ("New clip to review"), end-to-end encrypted; never titles, email text, recipients, journal or memories.
- The event ledger stores ids and counts, never your questions, answers, prices or message text.
- Health-check evidence is redacted (keys, tokens, emails) before it is stored or sent to the model.

**What does go out** (so there are no surprises): CORE, agents and nightly jobs send their prompts to Claude through your Claude Code login (Anthropic). Your memories, chats and tasks are stored in your Supabase project, and VAULT files get a cloud copy there. Web search runs as a separate call with only the search words, and is off when your files, private notes or journal are in the conversation.

## 6. Access

- ORBIT listens on 127.0.0.1 only. Phone access goes through `tailscale serve` (your tailnet only); never `tailscale funnel`.
- Set `ORBIT_ALLOWED_EMAILS`, or any account in your Supabase project can sign in.
- Each phone and each Shortcut token can be revoked in Profile → Phone remote. Changing `REMOTE_SECRET` revokes them all.
