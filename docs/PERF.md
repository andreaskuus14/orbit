# ORBIT open-time performance

Static review of what the home page (`src/app/page.tsx` → `Orbit.tsx`) pulls into its first JS load, which panels poll, and
which server reads run one after another. No build was run for this note; numbers are source bytes in the static import graph.

## Changed (branch `perf-bundle`)

**1. three.js out of the first load.** `Orbit` imported `AmbientSound.tsx` (which imported `@react-three/fiber`) and
`spatial-audio.ts` (which imported all of `three` for two pooled vectors). So three + R3F sat in the main chunk even though
the galaxy itself is `next/dynamic`.
- `spatial-audio.ts`: `import type` only; the pooled vectors are cloned once from the camera's own `Vector3`.
- The in-Canvas `AmbientListener` moved to its own file `AmbientListener.tsx`, imported only by `Galaxy.tsx`.
- Effect: three/R3F now load with the galaxy chunk. The HUD hydrates before three is parsed; the 2D view never loads it.

**2. Drawer panels load on first open.** `panels.tsx` (CORE, Profile, Analytics, Memory list), `AgentsPanels.tsx`
(Agents, Operations), `IntelligencePanel`, `DoctorPanel` and `RemoteCall` are now `next/dynamic` (`ssr:false`) with a small
"Loading…" line. `panels.tsx` is preloaded once at boot batch 3 (idle, after first paint) so CORE still opens at once on a
wake word. `MemoryWorld`'s `List` prop type widened to accept a dynamic component.
- Static graph from `Orbit.tsx`: 183 → 118 files, ~1.27 MB → ~0.80 MB of source (no `three`, no `@react-three/*`).

**3. Polls stop on a hidden tab.** `usePoll` (AgentMission.tsx; used by Missions, Company, Goals, AgentsStation,
AgentMission) said "visible-tab polling" but did not check; it now skips ticks while hidden and refreshes on return (same
pattern as `ContinueWork`). One-line `document.hidden` guards added to the fast polls that lacked one: Orbit's ship fleet
(20 s) and Higgsfield readout (60 s), Operations/Task view (3 s / 2.5 s), CORE plan card (4 s) and suggestions (60 s), Story
(2.5 s), Niche/Deal/Rivals boards (5 s), Clip Factory jobs/scout/batch (2–3 s).

**4. Independent server reads in parallel** (`Promise.all`, same results and error handling):
`school.ts` busy (calendar + focus), `study.ts` studyView, `devtools.ts` niche scan
(scout + learn state), `clips/learn.ts` tasteNotes, `api/memories/[id]/control` derived (two memory queries).
The first-load routes (`/api/morning`, `/api/continue`, `/api/weekly`, `/api/dayplan`, `/api/activity`, `/api/studio/busy`)
were already parallel.

## Not changed, and why
- `doctor.ts` vault check: the write probe must finish before `usage()` counts files.
- `clips/inbox-watch.ts`: `existed` must be read before `readState` (which may quarantine a damaged file).
- `Terminal`, `MissionControl` (small, event listeners that should be mounted by boot 3), `AlertWatch` and `StopAll`
  (alerts and the safety switch keep checking while hidden; 30–60 s), `ScreenApp` (a wall display, always visible).

## Changed (branch `perf-2`)

**5. Boot cards load their bodies only when they have something to show.** Each is now a small always-mounted gate that
decides, plus a `next/dynamic` body:
- `MorningCard.tsx` keeps all timing/fetch logic (auto-show, recap, "good morning" nav); the card's markup moved to
  `MorningCardBody.tsx`, so `MorningCards`, `NightShift` and with it `night-pure` + `goals-pure` (~47 KB) leave the first load.
- `MorningBrief.tsx` is the once-a-day check; `MorningBriefBody.tsx` (old component: fetch on mount, `DayPlan`) mounts keyed by
  the day, so a brief left open overnight refetches on the new day as before.
- `WhatsNew.tsx` mounts `WhatsNewBody.tsx` (+ `tour-pure` steps, 24 KB) only when the tour is unseen (same rule as
  `parseProgress`/`shouldAutoOpen`) or on `TOUR_EVENT` (Ctrl+K), passing `reopen` because the body's own listener did not exist
  yet. `TOUR_KEY`/`TOUR_EVENT` moved to `lib/tour-key-pure.ts` (re-exported from `tour-pure`): **bump `TOUR_KEY` there.**

**6. Wake word loads once hands-free is on.** `VoiceControls` mounts `voice/WakeWord.tsx` (dynamic; calls `useWakeWord` and
reports its state up) only when settings are loaded and hands-free ≠ Off. Switching hands-free on loads the chunk and starts
listening right away; Off unmounts it (same cleanup as before, state back to "off"). `useWakeWord`, `conversation`, `orbitmic`
(~31 KB) leave the first load. The mic button, Ctrl+M and the settings popover stay in the first load.

Static graph from `page.tsx` (`import type` and `import()` skipped): 129 → 115 files, ~855 KB → ~678 KB of source.
Tests: `tests/boot-gates.test.ts` (wake word mounts only with hands-free on, WakeWord resets on unmount, WhatsNew and
MorningBrief gates).

**Not changed:** `Herald` is a background watcher (polls, notifications, speech) whose logic is its body; nothing to defer.
`brief-pure` (17 KB) stays reachable via the MorningBrief gate for the one-line `shouldShowBrief`; tree-shaking should drop
the rest. The first open of each body now waits for its chunk (a "Loading…" moment on the morning card/brief).

## Remaining ideas
- Measure with `?perfrun=1` / the build's chunk report before and after these branches to confirm the first-load size drop.
