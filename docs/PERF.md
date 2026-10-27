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
`markets.ts` sync (quotes + histories), `school.ts` busy (calendar + focus), `study.ts` studyView, `devtools.ts` niche scan
(scout + learn state), `clips/learn.ts` tasteNotes, `api/memories/[id]/control` derived (two memory queries).
The first-load routes (`/api/morning`, `/api/continue`, `/api/weekly`, `/api/dayplan`, `/api/activity`, `/api/studio/busy`)
were already parallel.

## Not changed, and why
- `doctor.ts` vault check: the write probe must finish before `usage()` counts files.
- `clips/inbox-watch.ts`: `existed` must be read before `readState` (which may quarantine a damaged file).
- `Terminal`, `MissionControl` (small, event listeners that should be mounted by boot 3), `AlertWatch` and `StopAll`
  (alerts and the safety switch keep checking while hidden; 30–60 s), `ScreenApp` (a wall display, always visible).

## Remaining ideas
- Boot-batch-1 cards (`MorningCard`, `MorningBrief`, `Herald`, `WhatsNew` with `tour-pure` 24 KB) are always mounted but
  usually render nothing; each could be a tiny gate that dynamic-imports its body only when there is something to show.
- `VoiceControls` + `useWakeWord` (~40 KB) are needed only once voice is enabled; load on that setting.
- `night-pure`/`goals-pure` reach the first load via `NightShift`; check whether the HUD needs more than a label there.
- Measure with `?perfrun=1` / the build's chunk report before and after this branch to confirm the first-load size drop.
