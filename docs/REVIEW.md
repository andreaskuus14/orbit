# Reviewing a change (Atlas L13)

A review answers one question: **is this claim true for this exact code?** A claim nobody re-ran is not evidence.

## Every verdict records

| Field | Example |
|---|---|
| PR and exact head SHA | #463 at `d7ed5c3` (a review of an older head says nothing about a newer one) |
| Base it was tested on | merged onto main `d6edb1b` |
| Environment | Linux container, Node 22, Chromium (Playwright); isolated stack (`scripts/isolated/`); Windows PC |
| What ran, with counts | `npm run gate`: 3402 pass / 0 fail / 1 skip, build OK; `run-all.mjs core`: 7/7 PASS |
| What was mocked | fake Claude CLI, fake Resend, local Supabase, process `TZ` |
| What failed, and whether it's related | `bg-stop-resume-combined` timing flake under load; 3/3 on rerun |
| What was not checked | real iPhone, Windows reload, live Resend |
| Verdict | **PASS** or **CHANGES REQUESTED** with file:line and a concrete failing input |

## Claims and what proves them

| Claim | Not enough | Enough |
|---|---|---|
| "Fixed bug X" | the diff looks right | a test that fails on the old code and passes on the new one (a failing control) |
| "Tests pass" | the author's summary | the counts from a gate you ran at the same SHA, in a worktree nobody else was building in |
| "Works in the browser" | it compiles | a check or screenshot at named viewports, with the build's commit |
| "No leak" | "I grepped" | a planted marker (`PLANTED-…`) that never appears in the built prompt, log, notification or export |
| "Sends once" | the code has a guard | a fake receiver that counts effects, including a double click and a lost response |
| "Running version N" | the launcher said done | `/api/health` `commit` and Doctor "Running …" both match N |
| "Already existed" | memory | file:line and the existing test that proves it |

## Red flags

- The SHA in the verdict isn't the PR's current head.
- Two gates ran in one checkout at the same time (they share `.next`): rerun both.
- A test that passed first time and was never shown to fail: break the code once (mutation check) and confirm the test catches it.
- "Simulated" isn't stated: a fake provider is fine, an unstated one isn't.
- A finding with no failure scenario ("could be a problem"): ask for the input that breaks it, or drop it.
