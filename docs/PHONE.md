# ORBIT on your phone (private, no port opening)

ORBIT only listens on `127.0.0.1` on your PC, so nothing on your Wi-Fi or the internet can reach it. To use it from your phone, use **Tailscale Serve**. It gives ORBIT a private HTTPS address that only devices in your Tailscale network can open (yours, plus anyone you invite to it, which is why step 5 matters). It works away from home too, and HTTPS is what lets the phone's microphone work for voice.

ORBIT's code doesn't change for this. It stays bound to `127.0.0.1`; Tailscale forwards to it.

## One-time setup (about 10 minutes)

1. **Install Tailscale** on the PC (tailscale.com/download) and on your phone (App Store / Play Store). Sign in with the same account on both.
2. In the Tailscale admin console, under **DNS**, turn on **MagicDNS** and **HTTPS Certificates**.
3. On the PC, in PowerShell, with ORBIT running:
   ```
   tailscale serve --bg --https=443 localhost:3000
   ```
   It prints your address, like `https://arvuti.your-tailnet.ts.net`. (`tailscale serve status` shows it again.)
   Use **serve**, not **funnel**. Funnel would put ORBIT on the public internet.
4. **Supabase → Authentication → URL Configuration**: add `https://arvuti.your-tailnet.ts.net/auth/callback` (your address) to the redirect URLs. This lets the sign-in link work on the phone.
5. Make sure `.env.local` has `ORBIT_ALLOWED_EMAILS=your@email`. Without it, any account in your Supabase project can get in (🩺 Check ORBIT warns about this).
6. On the phone, open the address, sign in with your email link, then use the browser's **Add to Home Screen** / **Install app**. ORBIT opens full-screen like an app. On iPhone the home-screen app keeps its own sign-in, so you may need to sign in once more inside it.

## What works on the phone

- CORE chat and voice (the mic needs the HTTPS address above).
- All the planets. The drawer becomes a bottom sheet and the 2D view is the default on small screens.
- LIFE reminders show while ORBIT is open on the phone. They don't push when it's closed. (Only the /remote app below has push notifications, and only for approvals, Shorts, failures and Stop-all.)
- STUDIO, agents, Clip Factory and everything else still run on the PC. The phone is a remote screen for it, so **the PC must be on with ORBIT running**.

## Phone remote (/remote): approvals, Stop-all, Studio queue, ask CORE

A light page for the phone that doesn't need the full galaxy or a Supabase sign-in on the phone. It uses the same Tailscale Serve address as above; nothing else is exposed.

1. In `.env.local` on the PC, set `REMOTE_SECRET` to 32+ random characters (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`) and make sure `SUPABASE_SECRET_KEY` is set. Restart ORBIT.
2. On the iPhone, open `https://<your-pc>.<tailnet>.ts.net/remote` in Safari, tap Share → **Add to Home Screen**, then open **Remote** from the Home Screen. Pair from inside that app: on iPhone the home-screen app has its own cookies, separate from Safari.
3. On the PC: Profile → **Pair phone**. Type the 6-digit code into the phone within 2 minutes (5 wrong tries lock the code; press Pair phone again for a new one).
4. Paired phones are listed under Profile → Phone remote. **Revoke** stops one at once. Changing `REMOTE_SECRET` unpairs all of them.

What the phone can do: approve or reject clips waiting in review (it shows each clip's thumbnail; a clip without one is approved on the PC), approve a Higgsfield spend at its exact quoted credits, approve & send a BUSINESS email draft (it shows the full message and recipient), turn Stop-all **on** (resuming is done on the PC), see the Studio queue, and ask CORE (its chats are titled "Phone: …"). It can only act on items already waiting for you, exactly as it showed them (a clip, quote or draft that changed since must be reloaded); it can't start spends, sends or jobs. Retry clips that replace a published Short are reviewed on the PC. Every phone command is logged to the ledger (type and result, never the text).

### Notifications on the phone (iOS 16.4+)

Remote can buzz your phone when something needs you: a new clip to review, a Higgsfield quote ready, a BUSINESS draft ready to send (only when email sending is set up), a Short scheduled or published, a clip job or AI Story failed, or Stop-all switched on.

1. On the PC: `npm run remote:vapid`. It prints two lines (`REMOTE_VAPID_PUBLIC=…`, `REMOTE_VAPID_PRIVATE=…`). Paste both into `.env.local` and restart ORBIT. Keep the private one secret. Optional: `REMOTE_VAPID_SUBJECT=mailto:you@example.com` (the contact Apple sees; default is the first `ORBIT_ALLOWED_EMAILS`).
2. On the iPhone, open **Remote from the Home Screen** (notifications don't work in a Safari tab), scroll to **Notifications** and tap **Enable notifications**, then **Allow**. A "Notifications are on" test arrives within a few seconds.
3. Tapping a notification opens Remote at the right section.

What's in a notification: a fixed label like "New clip to review" or "A job failed" and a link into /remote. Never a clip title, email text, recipient, journal, memory or anything else you wrote; you see the details inside Remote after it opens. The label is end-to-end encrypted to the phone (Web Push), so Apple's push service only sees ciphertext.

Limits: at most one notification per kind every 2 minutes (more in that window are combined into one, like "3 new clips to review"). Quiet hours 23:00–08:00 Tallinn time: only failures come through; the rest are skipped (Remote still lists everything waiting). The PC must be on with ORBIT running to send them.

To stop: **Turn off on this phone** in Remote, or **Revoke** the phone on the PC (that deletes its subscription too), or remove the two `REMOTE_VAPID_*` lines. Making a new key pair turns them off until you tap Enable notifications again.

If the test doesn't arrive: check iPhone Settings → Notifications → Remote is allowed, that Focus isn't hiding it, and ORBIT's log on the PC for `[remote] push`.

### Voice calls: "ORBIT wants to talk"

ORBIT can call you, like a person would. The push says only "ORBIT wants to talk" and how many things need you; tap it, then **Answer** (iPhone only lets a page use the mic and speaker after a tap). ORBIT speaks first ("Morning. The night shift's done, and two things need your OK…"), then you just talk: **hands-free** (it hears when you stop) or **Hold to talk**. Talk over it and it stops. **Call ORBIT** in Remote starts a call yourself.

When it calls: the morning after the night shift if approvals are waiting (08:00–11:00), right after a job fails, when an approval has waited 4+ hours, or at your daily check-in time (set it under **Talk to ORBIT**). At most twice a day, an hour apart, never 23:00–08:00, never while Stop-all is on, never during a call.

Approving by voice: say "approve the squid clip". ORBIT names the exact item ("Approve the clip "Giant Squid"? Say yes to confirm.") and acts only on a plain **yes** within a minute, for that exact version; spends say the exact credits. Same checks as the Approve button. Anything else cancels. Rejecting works for clips only.

Privacy: your voice goes only phone → PC over Tailscale, is transcribed by Whisper on the PC and never saved. ORBIT's voice is made by Kokoro on the PC. When you hang up (or after 10 quiet minutes) a 2–4 sentence summary is saved as a memory (not the journal) and the ledger gets ids and counts only. Journal and LIFE never come up unless you ask. Needs the Voice settings' Local Whisper model on the PC (first call downloads it); if Whisper can't load, the call falls back to the phone's own speech recognition. Optional `.env.local`: `ORBIT_CALL_VOICE=` (a Kokoro voice, default `af_heart`).

Never use `tailscale funnel` for ORBIT: funnel puts it on the public internet. `tailscale serve` keeps it inside your tailnet, and ORBIT itself keeps listening on 127.0.0.1 only.

## If something doesn't work

- **The sign-in link opens localhost or fails:** check step 4, and open the link on the phone itself.
- **The address doesn't load:** check that Tailscale is connected on both devices and that `tailscale serve status` shows localhost:3000.
- **To turn phone access off:** run `tailscale serve --https=443 off` (or `tailscale serve reset`).
