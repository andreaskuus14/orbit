# What ORBIT can do (28 October 2026)

One section per planet. Each lists what the newer features do, where to find them, and what ORBIT **never** does without your click.
Older features are described in the [README](../README.md). Setup: [SETUP.md](SETUP.md). Safety rules: [SAFETY.md](SAFETY.md). Phone: [PHONE.md](PHONE.md).
New since 27 October: [Since you were away](#since-you-were-away) at the end of this page.

The short version of the rule: ORBIT may read, draft, plan and prepare on its own. Sending an email, spending credits, signing a contract and publishing a video each wait for your click (or, for email and publishing only, an Auto mode you switch on yourself: see [SAFETY.md](SAFETY.md)).

---

## CORE (the centre)

- **Chat and voice.** Ask anything; "Hey Orbit" or Ctrl+M for voice. Greetings, thanks, the time and "bye" are answered instantly without a model call.
- **Your week.** Ask "what slipped?", "what did I get done?", "how did my week go?". Answers cite the goal, task or clip they come from. Also in Ctrl+P → *Your week*.
- **Look at my screen.** Ctrl+Shift+L, the screen button next to CORE's input, or say "look at my screen …". You pick the window in the browser's own dialog; ORBIT takes **one** picture, stops capturing, and sends it with your question to CORE. The picture is not saved (only if you press *Save*). 🧩 *Roblox error* (next to it, and in GAME DEV) reads Studio's errors and links a fix checked against the official Roblox docs.
- **Remembers moments.** CORE recalls a couple of past "episodes" (see MEMORY) and the lessons you kept (see Profile) when they fit.
- **Missions:** a multi-step request becomes a mission with steps, receipts and checkpoints (AGENTS → Missions: pause, resume, retry, cancel).
- **Plan my day:** a time-blocked plan for today plus a commitment inbox; in the evening, mark done or missed.
- **Skills:** when you ask for the same multi-step thing 3+ times, ORBIT proposes a skill (AGENTS → Skills). Keep it, then say "run skill <name>: …".
- **Argue the other side:** for big decisions (contracts, big Higgsfield spends, autonomy raises, negotiation offers, goal plans) ORBIT's "twin" (◐) lists 3 risks and the best alternative before you decide. It never blocks anything.
- **Voice memos:** hold to record (CORE or phone). Whisper on the PC transcribes it and files it; *Change* or *Undo* if it filed it wrong. Tasks from memos wait for your *Start*.
- **Offline brain:** if Claude is unreachable, chat and summaries fall back to a local Ollama model (no tools) when `ORBIT_LOCAL_MODEL` is set.
- **Ctrl+K warp palette:** jump to any screen, search goals, approvals, people and prospects. It only opens screens; it never approves, sends or spends.
- **Language:** English / Eesti switch in Profile (CORE answers in Estonian too). The HUD, command bar, SYSTEM card, doctor, night shift, rules, open loops, LIFE, habit nudges and the phone Remote are now in Estonian as well.
- **What's new tour:** opens once after an update with short steps per feature, *Show me* buttons and setup hints; progress is saved. Reopen it any time from Ctrl+K → *What's new tour*.
- **The singularity shows what CORE is doing:** breathing when idle, rings tighten when listening, faster swirl when thinking, a scanning beam for web search, amber pulse when waiting for your approval.
- **Never without you:** CORE can't send, spend, sign or publish. Its only "outside" tools are *schedule clips you already approved* and *ask Higgsfield for a price* (no spending). Every tool call passes one safety check first ([SAFETY.md](SAFETY.md#core-tools)).

## MEMORY

- **Constellation:** every memory is a star; similar memories are linked by light that fades with age. A timeline replays how the web grew.
- **Chronicle** (Chronicle mode): your life and work as a river of days, with moments, streaks and "firsts". Scrub it or press play. Private journal moments appear only if you tick *Include private* (on this device only).
- **Episodes** (Episodes list, *Build now*): every night ORBIT turns calls, decisions, wins, setbacks and finished goals into short episode memories. Journal text is never used.
- **Where it came from:** every memory and belief shows its source. *Why?*, *Remember*, *Correct*, *Forget* on each one. Things ORBIT only guessed stay "suggested" until you confirm them.
- **Memory palace:** walk through your memories as rooms (WASD/arrows).
- **People ring:** the people in your life as moons, with a timeline and a check-in draft (you send it yourself).
- **Knowledge graph:** concept clusters and the bridges between them.
- **Study cards:** spaced repetition (Again/Hard/Good/Easy); *Learn this* on a memory drafts a card. "3 minutes of cards" in the morning brief.
- **Rewind:** ask "what happened last March?" and get facts for that time range.
- **Tidy-up suggestions:** up to 3 a week (merge duplicates, retire old or contradicted beliefs). Nothing changes until you press *Accept*.
- **Never without you:** nothing is merged, edited or deleted on its own.

## INTELLIGENCE

- News globe and Pulse briefings, every story sourced. Faster and smoother now; no new actions.

## GAME DEV

- **Sessions tab:** every Luau helper run, build, scan and playtest ORBIT does in Roblox Studio is logged as a session (closes after 30 idle minutes or *End*). Yesterday's session appears in the morning brief, and it can suggest a "Day N" Short idea.
- **Backlog:** the bug tracker now holds bugs, features and polish with priority. Paste a list (or GitHub issues text) to import. Any item can become a Goal or open the Luau helper's Fix mode. Fix suggestions are checked against create.roblox.com pages and cite them.
- **Personas tab (playtest):** 20 simulated player types "play" your pet sim overnight. A few real look-only Studio playtests (walk, look, read the console) plus one model walkthrough, scored into a funnel and suggested backlog items.
- **Economy tab:** economy balancer, update-notes drafter, and economy personas that stress-test your prices.
- **Never without you:** ORBIT never edits your place or scripts. Suggested backlog items only go in when you click *Add*.

## OPERATIONS

- Agent tasks, projects, automations. *Save as recipe* on a finished task; re-run it from AGENTS → Recipes or by saying "run recipe <name>".

## AGENTS

- **Tonight tab (night shift):** queue things for tonight ("tonight, research …"). Each night (default 01:00–06:30 Tallinn time, only while you're idle) ORBIT works through your asks, one step of each goal plan you approved, BUSINESS follow-up drafts, Shorts prep up to review, the weekly niche scout, memory tidy-up suggestions, the health check and the persona playtest. It has a budget (max 40 Claude calls, 150 minutes).
- **"While you slept"** card in the morning with one-tap approve/reject.
- **Company tab:** a CEO planner splits a goal into 2–4 role steps (researcher, analyst, writer, ops) run as a team, with a budget per role; *🌙 Tonight* runs it in the night shift.
- **Missions** and **Skills** tabs: see CORE above. **ORBIT's log**: its nightly diary of what it did and learned.
- **Night shift v3:** learns which kinds of night work you approve and does more of those; also dreams up idea combinations (DREAMS list, keep/discard), makes a 25-second private recap reel, and runs the nightly encrypted backup.
- **Ships:** running tasks fly across the galaxy as small ships; amber blink = waiting for you.
- **Rules tab (standing rules):** plain-language rules like "every weekday 7:30 check deals" or "when a client replies, draft a follow-up" (English and some Estonian). CORE can propose one when you ask; you confirm the parsed version here. Schedule rules and event rules (client replied, deal found, note saved, briefing ready) run only through the existing agent tasks, skills, missions, deal hunter and week facts, so every approval still applies. *Run now* tries a rule once; *Pause* is one tap. Event rules run at most 5 times a day; skipped events show on the card.
- **Open loops** (in mission control, Ctrl+K or "mission control"): each night a rules-only scan (no model calls) lists things left hanging: promises you made in CORE or the commitment inbox, replies you're waiting on, stalled goals and missions (7 days), prospects past follow-up, drafts waiting 3+ days, overdue invoices, unsigned contracts. Each has evidence and one next step: *Close*, *Snooze 3 days* or *Turn into task* (adds it to today's plan). The morning brief gets one line. Journal and LIFE are never read.
- **Goals:** a goal can come from a GAME DEV backlog item or from the weekly review's *Add to next week*.
- **Never without you:** the night shift never sends, publishes or spends. Everything with an outside effect waits in the morning for your click.

## LIFE

- **Today in a minute** (Ctrl+Shift+E, or "today in a minute"): a short evening journal note, also offered once a day after the 19:00 briefing.
- **School:** courses and deadlines; ORBIT plans study blocks backwards from each deadline and warns about overloaded weeks.
- **Habits:** each habit gets its own time window and channel; nudges learn your timing, back off when ignored, and *Done* works from the push.
- **Focus blocks (time dilation):** 25/50/90 minutes on one goal. The galaxy slows, pushes, calls and bell notices are held (urgent ones pass), and you get a summary at the end.
- Journal entries are private: ORBIT never learns beliefs from them, CORE's memory search skips them, and no nightly job reads them.

## VAULT

- Your private files. Signed contracts (PDF) and ARCH scans (.splat) are stored here.

## ANALYTICS

- **Operator report:** weekly card of what ORBIT did on its own.
- **Make ORBIT better:** once a week, up to 5 improvement tasks with evidence (in 🩺 Check ORBIT). *Draft patch* on a task makes one Claude call with up to 4 relevant files and saves a diff + test + reason as a local `.patch` file, with *Copy* for Claude Code. Drafts survive a reload. A safety check refuses patches that touch AGENTS.md, approvals/autonomy/Stop-all, REA, `.env` or CI, weaken tests or remove guards. Nothing is ever applied, committed or pushed.
- **Agent scorecard:** once a month ORBIT replays 10 fixed practice cases through the agents and grades them, with trend and worst case.
- **Predictions:** before you decide on a clip, proposal, draft, tidy-up, niche or deal, ORBIT quietly guesses what you'll do and keeps score. The hint shows on the card. It never acts on a guess.
- **PERF card:** frame rate and speed runs (open ORBIT with `?perfrun=1` or press Shift+Alt+P).

## STUDIO (YouTube)

Clip Factory tabs: Pipeline · Find videos · Clips · AI Story · Long-form · Calendar · Insights · Autopilot.

- **Pipeline:** idea → script → clip/story → thumbnail + title → review → scheduled, with a weekly target (default 7).
- **Shorts autopilot v2** (on the Pipeline board): picks the week's ideas, writes scripts and asks Higgsfield for prices overnight, then offers **one** morning button like "Approve 3 Shorts for 210 credits". *Plan + script now* runs it on demand.
- **AI Story:** Claude writes a short story or a "talking drama" (fruit-head characters speaking their own lines); *Get cost* asks Higgsfield for the price; *Approve & generate (N credits)* is the only button that spends. Drama runs are two approvals: character pictures first, then the shots. Finished videos land in the normal review queue.
- **Long-form:** topic → 8–12 minute plan (titles, hook, chapters with script and shots, thumbnail ideas, 3 Shorts cut-downs). Exports script, shot list and chapters. Visuals are only priced drafts in the AI Story queue.
- **Daily recap reel:** a private 25-second video of ORBIT's day, made on the PC after the night shift.
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
- **Invoices and Money:** invoices with VAT and reference numbers, an owed dashboard, reminder drafts for overdue ones (approve to send), and a monthly profit & loss view with expenses and Estonian tax deadlines.
- **Store launch package:** Shopify/WooCommerce CSV, Etsy text, prices from your margin, SEO, EU policy drafts and a 14-day plan. Image prompts only go to Higgsfield as a priced draft.
- **Competitor watch:** weekly read-only report on up to 5 public competitor pages per kept niche (new products, price moves).
- **What-if simulator:** drag ranges (clicks, conversion, costs) and see the chance of losing money. No model calls.
- **AI visibility:** does Claude know your shop/game/channel, and what does the web say.
- **Never without you:** invoice reminders go only on your click, like drafts. ORBIT never sends an email unless you click (or you switch BUSINESS email to Auto). It **never signs** or sends a contract on its own, and there's no phone, voice or auto path for contracts. Shops are never deployed. Prices and promises always need you, even in Auto.

## ARCH

- **Scans:** import a .ply/.splat scan, walk around it, and **measure** inside it (two clicks, calibrate on a known length).
- **Sketch critique:** photo of your sketch → feedback on proportion, circulation, light, structure, saved to MEMORY.
- **Precedents:** "Teach me <building>" lessons, scans and critiques, all linked and searchable.
- **Weekly digest** on Sunday evening (also a line in the weekly review).
- **Floor-plan generator:** a brief → 3–5 scored layouts (with a stair core for several floors); pick one and it becomes the model.
- **Structure coach:** checks each upper floor as timber joists or a concrete slab with the working shown, failing ones turn red (a teaching estimate, not engineering).
- **Materials lab:** cost, embodied carbon and U-values, scheme A vs B.
- **Stairs:** upper floors get a stairwell opening above the stair core, and the cost list prices stairs per riser (starter 150 EUR/riser).
- **Daylight study:** sun hours per room. **Model city:** plot, setbacks, coverage, neighbours and their shadows.
- **Time machine:** every change is saved; scrub back through versions and *Restore*.
- **Studio crit:** one tutor critique per model version, from computed facts and a screenshot.
- **Portfolio:** your ARCH captures and picked work as an A4 PDF and a static web page.
- Holotable and first-person walk modes, sun study, windows/doors, quantities and cost export.

---

## Morning, evening, week

- **Good morning brief** (PC): on the first open after 06:00, a spoken 60-second brief (decisions waiting, night shift, calendar, "do this first", a result, a pattern). One-tap approve/open/snooze. Emails and spends only *open* so you read the exact thing first. Calendar titles and reminders are spoken only if you tick that box.
- **Do this first:** one top card on the morning stack.
- **Place and weather (opt-in):** Profile toggle. The phone can send a rough location (about 1 km) on *Update place*; the brief then adds a weather line and reminders tied to saved places. Off = the point is deleted.
- **Weekly review** (Sunday evening): summary + one experiment; *Add to next week* turns it into a draft goal.

## Profile

- **Autonomy:** how much ORBIT may do on its own per area ([SAFETY.md](SAFETY.md#autonomy-levels)).
- **Phone remote:** pair your iPhone, Shortcuts & Watch tokens ([PHONE.md](PHONE.md)).
- **ORBIT's character:** sliders for warmth, humour, directness, length, plus the call voice. Honesty is fixed: ORBIT won't flatter you, will disagree once with a reason, and never claims to be human.
- **Time capsule:** encrypted nightly backups of ORBIT's local folder into a folder you pick (external drive, OneDrive folder…), plus a restore wizard ([SETUP.md](SETUP.md#9-time-capsule-backups)).
- **What I learned about you:** lessons ORBIT noticed from your own decisions. *Keep* or *Not true*. Kept ones shape CORE, the morning order, clip picking and the night shift.
- 🩺 **Check ORBIT** (Ctrl+P → *Check ORBIT health*): setup check plus the nightly **HEALTH** card (problems from the logs, redacted, with *Copy for builder*). It never changes code.
- **SYSTEM card** (in Check ORBIT): each service with its last success (Supabase, Claude CLI, Resend, Higgsfield, Ollama, phone push, calendar), failed tasks, missions, night tasks and clip renders over 7 days, free space for data/vault/studio/backup, models, Claude use over 5 hours and 7 days (set `ORBIT_CLAUDE_WEEKLY_CALLS` to see a weekly budget), the Higgsfield weekly cap and last night's budget. A check every 10 minutes keeps **incidents**: a problem seen twice in a row sends one fixed-label push (held through quiet hours) and resolves itself when fixed.

## Phone

Remote app (home screen with a Needs-you stack), push notifications, voice calls ("ORBIT wants to talk"), car mode (big Talk button, spoken brief, no approvals while driving), Siri/Watch Shortcuts: [PHONE.md](PHONE.md). A tablet or second monitor can show a read-only mission control at `/screen` (paired like a phone, can't approve or stop anything). The Remote's *Night report* shows last night's titles and counts only (no drafts, amounts or links).

---

## Since you were away

Built 27–28 October (PRs #234–#247, plus two branches waiting to merge).

**New, and how to try each in one line**

| What | Try it |
|------|--------|
| What's new tour | Open ORBIT; it starts by itself once. Later: Ctrl+K → *What's new tour*. |
| Open loops | Say "mission control"; the *Open loops* list is there (*Scan now* if it's empty). |
| Standing rules | Tell CORE "every weekday at 8, check my deals", confirm it in AGENTS → Rules, press *Run now*. |
| System health + incidents | Ctrl+P → *Check ORBIT health*, look at the SYSTEM card. |
| Patch drafts | In Check ORBIT → *Make ORBIT better*, press *Draft patch* on a task, then *Copy*. |
| More Estonian | Profile → *Eesti*; the HUD, doctor, rules and loops follow. |
| Phone night report | Open Remote on the phone in the morning: *Night report*. |
| Stairwell openings | ARCH: generate a 2-floor plan and look at the upper slab and the cost list. |
| Faster first load | Nothing to do: 3D and drawer panels, boot cards and the wake word now load only when needed. |
| Accessibility | Dialogs take focus and close on Esc; news pins work by keyboard; brief and tour are announced to screen readers. |
| Demo fixtures | Open `/demo`: STUDIO stats/clips, follows, place and ARCH studio/versions now show sample data. |
| Smoke test | With ORBIT running: `npm run smoke` (browser pass over /demo, /remote, /screen, /login on desktop and phone sizes). |

Builder-side checks added to `npm test`: an Estonian coverage ratchet (`tests/i18n-coverage.test.ts`: hard-coded English per component may only go down), static a11y lints (`tests/a11y-static.test.ts`: unnamed buttons, images without alt, unlabelled fields), and, once branch `route-guards` merges, `tests/route-guards.test.ts` (every API route must check sign-in and cross-site writes).

**Needs your action**

- **Optional:** set `ORBIT_CLAUDE_WEEKLY_CALLS` in `.env.local` (your weekly Claude budget in calls) so the SYSTEM card shows use against it ([SETUP.md](SETUP.md#claude-core)).
- **Decide on the Agent SDK.** The study recommends moving CORE to the Claude Agent SDK step by step behind `ORBIT_CORE_ENGINE=sdk` (real tool-call ids, structured errors, parallel tools, built-in sessions and caching). Costs: about 320 MB more `node_modules`, and if ORBIT is ever shared or sold it must switch to an API key. Findings: `docs/AGENT-SDK.md` (branch `agent-sdk-doc`, waiting to merge); the prototype stays unmerged on `agent-sdk-study`. Say yes and it gets merged and tested once on the PC.
- **Logo file:** `public/brand/orbit-mark.png` isn't in the repo. If your PC doesn't have it either, ORBIT shows a text mark instead; put a square PNG there (and commit it if you want it everywhere).
- Nothing new in Supabase: no new migrations this round.
