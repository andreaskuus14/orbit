# Stop-all: exact semantics per runner

Short version for the owner: [SAFETY.md §3](SAFETY.md#3-stop-all). This page is the engineering contract; tests: `tests/stop-all.test.ts`, `tests/stop-all-runners.test.ts`.

## The flag

- Stored in `<ORBIT data dir>/stop-all.json` (`src/lib/stop-all.ts`), written atomically (tmp + rename).
- Every check (`stopAllOn()`) stats the file and re-reads it when its mtime/size changed, so a **second process or a restart sees the toggle** without a restart. Own toggles take effect in memory at once, even if the disk write fails (the API then returns a warning: it resets on restart).
- Only a missing file means off. A file that can't be read (e.g. a Windows antivirus lock at boot) or isn't valid JSON (a power cut can leave it empty) **fails closed**: ORBIT starts paused and shows the banner; Resume rewrites the file. A read error is retried on the next check.
- On: `switchStopAll` (`src/lib/stop-all-run.ts`) also cancels what is running **in this process** (tasks, team chains, goal drivers, niche scout, night shift step, deal hunt) and clears the Auto send/publish queue. Work running in **another** process stops at its next boundary check below.
- Off is PC-only (phone and Shortcuts can only turn it on). Off re-kicks the task queue, chains, goals and the clip queue.

## Per runner

| Runner | Queued | Running | Awaiting approval | Waiting for capacity | On Resume |
|---|---|---|---|---|---|
| Agent task queue (`agents.ts` kickQueue/runTask) | stays queued (kickQueue doesn't start; a claim that races with Stop-all is handed back to `queued`) | cancelled: in-process via `cancelTask`; any process at the next step, both before each model call and right before each tool runs | **approve refused** (409, item keeps waiting); reject still works | — | kickQueue starts queued ones; `claimTask` makes each start exactly once across workers |
| Team chains / missions (`chains.ts` drive, `missions.ts`) | step stays queued | in-process: chain cancelled (its driver is in the live map). Other process: running step cancelled at its next step; the driver stops before the next step, chain row stays `running` | as tasks | step that waited for a slot **doesn't start** (stays queued) | `resumeChains`/`resumeMissions` drive the next queued step; one driver per chain per process, and `claimTask` stops a second process running the same step |
| Goals (`goals.ts`) | — | drivers aborted; loop re-checks before every step | as tasks | shares the chain slot wait (`withSlot`) | `resumeGoals` |
| Plans (`plans.ts`) | — | stops between steps, stays `running` | — | — | `resumePlans` continues |
| Night shift (`night.ts`) | doesn't start | current step aborted, run marked `stop-all` | — | — | next night only |
| Standing rules / automations (`rules.ts`, `automations.ts`) | not fired | they only start tasks/missions, which obey the rows above | — | — | next trigger |
| Scheduler tick (`scheduler.ts`) | whole tick skipped (no queue kicks, resumes, briefings, proposals, backups) | — | — | — | next tick |
| Auto email / Short queue (`autonomy.ts`) | **cancelled** (not resumed; a cancelled version never re-queues) | `business-send` refuses at send time | — | — | nothing re-queued |
| Clip render queue (`clips/factory.ts`) | waits | a render already under way **finishes** | — | — | `resumeClipQueue` |
| Scheduled publishing (`clips/publish-schedule.ts`) | batch stops | an upload already under way **finishes** | needs owner approval as before | an upload waiting for another upload **doesn't start** | owner presses Schedule again; `eligible()` skips clips already scheduled |
| Higgsfield story (`clips/story.ts`) | — | a story already submitted finishes (credits are committed at submit) | Approve & generate refused | — | owner clicks again |
| Email / contract / negotiation / invoice sends | refused (503) | — | refused | — | owner clicks again (fingerprint check as usual) |
| CORE turns (`core.ts`, `policy-pure.ts`) | — | a turn continues, but every work-starting tool (`STARTS_WORK`) is refused per call | — | — | — |
| Phone / Remote / Shortcuts / voice | can turn Stop-all on, not off | — | approvals go through the same functions, so they are refused too | — | — |
| Calls (`call.ts`) | ORBIT never calls | — | — | — | — |

## Unavoidable in-flight effects

- A Claude request already sent: in-process it is aborted through its signal; in another process it completes and its result is discarded at the next check (it may still count toward usage).
- A YouTube upload or ffmpeg render under way finishes (killing it can leave broken files or a half-uploaded video).
- A Higgsfield submit already sent: the credits are spent; the generation and assembly finish.
- An approval click already executing (`resolvePending`) runs its approved actions to the end, as one unit; Stop-all doesn't cut it half-way.
- An email whose SMTP send already began.
- A reach/web scan stops at its next request.

## No duplicates on resume

Every resume path re-reads the database/state, never an in-memory list: tasks start only through an atomic claim, approvals through a compare-and-swap on `awaiting_approval`, chain steps only from `queued`, publishing only for clips still `approved` and unscheduled, and the Auto queue is cancelled rather than paused.
