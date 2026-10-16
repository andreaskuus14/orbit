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
- LIFE reminders show while ORBIT is open on the phone. They don't push when it's closed (no service worker, by design).
- STUDIO, agents, Clip Factory and everything else still run on the PC. The phone is a remote screen for it, so **the PC must be on with ORBIT running**.

## If something doesn't work

- **The sign-in link opens localhost or fails:** check step 4, and open the link on the phone itself.
- **The address doesn't load:** check that Tailscale is connected on both devices and that `tailscale serve status` shows localhost:3000.
- **To turn phone access off:** run `tailscale serve --https=443 off` (or `tailscale serve reset`).
