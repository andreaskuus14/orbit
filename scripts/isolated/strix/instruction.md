# Scope: ORBIT isolated test copy (authorized by its owner)

Target: http://127.0.0.1:3100 only. This is a throwaway copy with a local Supabase, a fake model CLI and test data. Do not
contact any other host. Do not try to reach the internet, the local Supabase admin ports directly, or the Docker daemon.
Test account: the email and password are given below by the harness (throwaway, @example.test).

Focus (in this order):
1. Auth and session: pages and /api routes reachable without a session, session fixation, the ORBIT_ALLOWED_EMAILS gate
   (a signed-in but not allowed account must get no data), cookie flags.
2. CSRF and approvals: state-changing POSTs without the same-site checks; task approvals at /api/tasks/[id] (the `seen`
   fingerprint must block a changed action); one-tap approval links at /api/remote/ntfy-act (token forgery, replay, expiry,
   changed action after the notification).
3. Phone pairing and remote routes: /remote, /api/remote/* (pair code guessing and rate limits, device token theft or reuse,
   acting as another device).
4. File routes: /w/* workspace previews and VAULT downloads (path traversal, other users' files, content-type confusion,
   scripts served from previews running with ORBIT's origin).
5. SSRF: any feature that fetches a URL server-side or in the hidden browser (research, scrape, link previews): redirects to
   127.0.0.1, localhost, 169.254.169.254, 10/8, 192.168/16, IPv6 loopback, DNS rebinding.
6. CSP and XSS: injected HTML in task titles, memories, briefings, site copy; whether a nonce-less script can run.

Do not run destructive load (no flooding, no deleting the database). Report each finding with the exact request, the
response that proves it, severity, and a suggested fix.
