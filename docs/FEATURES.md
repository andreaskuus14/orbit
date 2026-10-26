# What ORBIT can do (October 2026)

One section per planet. Each lists what the newer features do, where to find them, and what ORBIT **never** does without your click.
Older features are described in the [README](../README.md). Setup: [SETUP.md](SETUP.md). Safety rules: [SAFETY.md](SAFETY.md). Phone: [PHONE.md](PHONE.md).

The short version of the rule: ORBIT may read, draft, plan and prepare on its own. Sending an email, spending credits, signing a contract and publishing a video each wait for your click (or, for email and publishing only, an Auto mode you switch on yourself: see [SAFETY.md](SAFETY.md)).

---

## CORE (the centre)

- **Chat and voice.** Ask anything; "Hey Orbit" or Ctrl+M for voice. Greetings, thanks, the time and "bye" are answered instantly without a model call.
- **Your week.** Ask "what slipped?", "what did I get done?", "how did my week go?". Answers cite the goal, task or clip they come from. Also in Ctrl+P → *Your week*.
- **Look at my screen.** Ctrl+Shift+L, the screen button next to CORE's input, or say "look at my screen …". You pick the window in the browser's own dialog; ORBIT takes **one** picture, stops capturing, and sends it with your question to CORE. The picture is not saved (only if you press *Save*). In GAME DEV there's a Roblox-error version that checks its fix against the official Roblox docs.
- **Remembers moments.** CORE recalls a couple of past "episodes" (see MEMORY) and the lessons you kept (see Profile) when they fit.
- **The singularity shows what CORE is doing:** breathing when idle, rings tighten when listening, faster swirl when thinking, a scanning beam for web search, amber pulse when waiting for your approval.
- **Never without you:** CORE can't send, spend, sign or publish. Its only "outside" tools are *schedule clips you already approved* and *ask Higgsfield for a price* (no spending). Every tool call passes one safety check first ([SAFETY.md](SAFETY.md#core-tools)).

## MEMORY

- **Constellation:** every memory is a star; similar memories are linked by light that fades with age. A timeline replays how the web grew.
- **Chronicle** (Chronicle mode): your life and work as a river of days, with moments, streaks and "firsts". Scrub it or press play. Private journal moments appear only if you turn on *include private*.
- **Episodes** (Episodes list, *Build now*): every night ORBIT turns calls, decisions, wins, setbacks and finished goals into short episode memories. Journal text is never used.
- **Tidy-up suggestions:** up to 3 a week (merge duplicates, retire old or contradicted beliefs). Nothing changes until you press *Accept*.
- **Never without you:** nothing is merged, edited or deleted on its own.

## INTELLIGENCE

- News globe and Pulse briefings, every story sourced. Faster and smoother now; no new actions.

## GAME DEV

- **Sessions tab:** every Luau helper run, build, scan and playtest ORBIT does in Roblox Studio is logged as a session (closes after 30 idle minutes or *End*). Yesterday's session appears in the morning brief, and it can suggest a "Day N" Short idea.
- **Backlog:** the bug tracker now holds bugs, features and polish with priority. Paste a list (or GitHub issues text) to import. Any item can become a Goal or open the Luau helper's Fix mode. Fix suggestions are checked against create.roblox.com pages and cite them.
- **Personas tab (playtest):** 20 simulated player types "play" your pet sim overnight. A few real look-only Studio playtests (walk, look, read the console) plus one model walkthrough, scored into a funnel and suggested backlog items.
- **Never without you:** ORBIT never edits your place or scripts. Suggested backlog items only go in when you click *Add*.

## OPERATIONS

- Agent tasks, projects, automations. *Save as recipe* on a finished task; re-run it from AGENTS → Recipes or by saying "run recipe <name>".

## AGENTS

- **Tonight tab (night shift):** queue things for tonight ("tonight, research …"). Each night (default 01:00–06:30 Tallinn time, only while you're idle) ORBIT works through your asks, one step of each goal plan you approved, BUSINESS follow-up drafts, Shorts prep up to review, the weekly niche scout, memory tidy-up suggestions, the health check and the persona playtest. It has a budget (max 40 Claude calls, 150 minutes).
- **"While you slept"** card in the morning with one-tap approve/reject.
- **Ships:** running tasks fly across the galaxy as small ships; amber blink = waiting for you.
- **Goals:** a goal can come from a GAME DEV backlog item or from the weekly review's *Add to next week*.
- **Never without you:** the night shift never sends, publishes or spends. Everything with an outside effect waits in the morning for your click.

## LIFE

- **Today in a minute** (Ctrl+Shift+E, or "today in a minute"): a short evening journal note, also offered once a day after the 19:00 briefing.
- Journal entries are private: ORBIT never learns beliefs from them, CORE's memory search skips them, and no nightly job reads them.

## VAULT

- Your private files. Signed contracts (PDF) and ARCH scans (.splat) are stored here.

## ANALYTICS

- **Agent scorecard:** once a month ORBIT replays 10 fixed practice cases through the agents and grades them, with trend and worst case.
- **Predictions:** before you decide on a clip, proposal, draft, tidy-up, niche or deal, ORBIT quietly guesses what you'll do and keeps score. The hint shows on the card. It never acts on a guess.
- **PERF card:** frame rate and speed runs (open ORBIT with `?perfrun=1` or press Shift+Alt+P).

## STUDIO (YouTube)

Clip Factory tabs: Pipeline · Find videos · Clips · AI Story · Calendar · Insights · Autopilot.

- **Pipeline:** idea → script → clip/story → thumbnail + title → review → scheduled, with a weekly target (default 7).
- **Shorts autopilot v2** (on the Pipeline board): picks the week's ideas, writes scripts and asks Higgsfield for prices overnight, then offers **one** morning button like "Approve 3 Shorts for 210 credits". *Plan + script now* runs it on demand.
- **AI Story:** Claude writes a short story or a "talking drama" (fruit-head characters speaking their own lines); *Get cost* asks Higgsfield for the price; *Approve & generate (N credits)* is the only button that spends. Drama runs are two approvals: character pictures first, then the shots. Finished videos land in the normal review queue.
- **Title scorer:** ranks 2–5 titles against your own click-through history.
- **Hook lab:** three alternative openings of a clip, ranked from your past results.
- **Retention post-mortem:** 48 hours after a Short goes live, ORBIT shows where viewers left and proposes one rule. It enters your playbook only when you click *Add to playbook*.
- **Comment ideas:** recurring questions in your Shorts' comments become IDEA RADAR ideas. Nothing is posted.
- **Never without you:** no upload without your *Approve* in review (or Studio publish set to Auto, see [SAFETY.md](SAFETY.md)). No Higgsfield credit is spent without your *Approve* on the exact quote, and never past your weekly cap. Another creator's clip can't be published until you write "What I added".

## THEATER

- Find a creator's newest videos by voice and watch them. No changes.

## MARKETS

- **Deals tab (deal hunter):** keep a wishlist ("I want a used RTX 4070 under 400€" works in CORE too). ORBIT checks public shop pages every 6 hours in the daytime (max 3 checks a run, 12 a day) and in the night shift. A great deal (at/under your target or 15%+ under the 30-day median) gets a push and may ring you. Cards show the link, why it's good and a message you can copy to the seller.
- **Negotiation box** on an offer: paste the seller's reply; ORBIT drafts a counter inside the limits you set.
- **Never without you:** ORBIT never logs in, messages a seller or buys anything. Paper trading is simulation only.

## BUSINESS

- **Approve & send:** two clicks send the exact draft you read to the business's one email address (needs Resend, see [SETUP.md](SETUP.md#resend-email)).
- **Research** a prospect's public pages; drafts use an *angle* (speed, missed leads, free pilot), and the **Scorecard** shows reply rate per angle.
- **Niche scout:** weekly webshop ideas, each backed by 2+ web sources. *Keep / Dismiss / Build shop*.
- **Shop-in-a-box:** *Build shop* makes one static landing page + launch kit on your PC (preview only).
- **Negotiation box** on a prospect: paste their reply; ORBIT classifies it and drafts a counter-offer that always stays between your floor and ceiling. *Approve* emails it (with Resend) or marks it for you to copy.
- **Contracts:** drafted from vetted templates (service, purchase, sponsorship, NDA) on your click, with every change from the template shown. You *Sign*; *Approve & send* emails the signed PDF.
- **AI visibility:** does Claude know your shop/game/channel, and what does the web say.
- **Never without you:** ORBIT never sends an email unless you click (or you switch BUSINESS email to Auto). It **never signs** or sends a contract on its own, and there's no phone, voice or auto path for contracts. Shops are never deployed. Prices and promises always need you, even in Auto.

## ARCH

- **Scans:** import a .ply/.splat scan, walk around it, and **measure** inside it (two clicks, calibrate on a known length).
- **Sketch critique:** photo of your sketch → feedback on proportion, circulation, light, structure, saved to MEMORY.
- **Precedents:** "Teach me <building>" lessons, scans and critiques, all linked and searchable.
- **Weekly digest** on Sunday evening (also a line in the weekly review).
- Holotable and first-person walk modes, sun study, windows/doors, quantities and cost export.

---

## Morning, evening, week

- **Good morning brief** (PC): on the first open after 06:00, a spoken 60-second brief (decisions waiting, night shift, calendar, "do this first", a result, a pattern). One-tap approve/open/snooze. Emails and spends only *open* so you read the exact thing first. Calendar titles and reminders are spoken only if you tick that box.
- **Do this first:** one top card on the morning stack.
- **Weekly review** (Sunday evening): summary + one experiment; *Add to next week* turns it into a draft goal.

## Profile

- **Autonomy:** how much ORBIT may do on its own per area ([SAFETY.md](SAFETY.md#autonomy-levels)).
- **Phone remote:** pair your iPhone, Shortcuts & Watch tokens ([PHONE.md](PHONE.md)).
- **ORBIT's character:** sliders for warmth, humour, directness, length, plus the call voice. Honesty is fixed: ORBIT won't flatter you, will disagree once with a reason, and never claims to be human.
- **What I learned about you:** lessons ORBIT noticed from your own decisions. *Keep* or *Not true*. Kept ones shape CORE, the morning order, clip picking and the night shift.
- 🩺 **Check ORBIT** (Ctrl+P → *Check ORBIT health*): setup check plus the nightly **HEALTH** card (problems from the logs, redacted, with *Copy for builder*). It never changes code.

## Phone

Remote app, push notifications, voice calls ("ORBIT wants to talk"), Siri/Watch Shortcuts: all in [PHONE.md](PHONE.md).
