# Planet audit — 21 Nov 2026

How it was checked: the real galaxy (`/demo`) and every planet's real panel and world rendered in a browser against a backend
that answers 500, an empty `{}` and an HTML gateway page; the shared planet page screenshotted before and after; `npm run gate`.

## Fixed in this PR
| Where | Problem | Fix |
|---|---|---|
| Galaxy / every world | three's `compileAsync` threw inside a timer when a material was disposed mid-compile; its promise never settled, so a canvas waited for its 20 s cap | `compileSafe` (WarmCompile.tsx): a released material counts as done |
| Server | a browser hanging up on its own request (`ECONNRESET aborted` from `abortIncoming`) was treated as fatal: ORBIT stopped and restarted | `clientAborted` carve-out in crash-log.ts; outbound network errors stay fatal (tests) |
| Whole app | no error boundary anywhere: one render error in any planet blanked ORBIT | `PlanetBoundary` around every world, planet panel and drawer; `global-error.tsx` |
| PROFILE | any failing `/api/dub` reply crashed all of Profile | DubVoice checks the reply |
| PROFILE → voice | "Removed" shown even when deleting the voice sample failed | only says removed when the server did |
| Every planet page | count said 2 while 3 cards showed (finished work sat under "Working on it"); needs-you not first | finished work moves to Results as one ticked line; needs → failed → working → queued |

## Design + motion (shared planet page, so all 11 planets)
Planet colour on the working bar, dot and focus ring; needs-you amber edge and button; done steps hidden (the result says it);
skeleton loading instead of "Loading…"; the input hint cycles the planet's example asks; staggered rise-in (32–320 ms), live
sheen on running work, press/hover feedback, smooth More disclosure. All motion off under reduced motion.

## Still open (next)
1. Contract hardening: a 200 reply missing its list crashes BUSINESS, VAULT, INTELLIGENCE, MEMORY, AGENTS (panel + station),
   PROFILE → Autonomy, ARCH → ProjectDesk, MEMORY world. Boundaries now contain it; each reader should default its arrays.
2. "All tools" density: ARCH 47 buttons, BUSINESS 30, LIFE 26, DEV 19, INTELLIGENCE 17. Move the 2–3 most used into each
   simple page as results/actions; keep the rest behind More.
3. Two tests need local setup: `frame-review` needs the ffmpeg-static binary; the 512 MB worker test fails when NODE_OPTIONS
   raises the heap.
4. `next dev` needs ~4 GB: on the laptop prefer `app:start` (production) over `app:dev`.
