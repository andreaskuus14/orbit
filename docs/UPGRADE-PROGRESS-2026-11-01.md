# ORBIT upgrade work

Implementation branch: `codex/idea-radar-transcripts`. Claude reviews, merges and deploys. Research candidates are options, not installation instructions or delivered capabilities.

## Built in this branch

- **AGENTS / research:** public transcript intake in Idea Radar, guarded by explicit public-source confirmation. Undated research remains labeled and excluded from automatic Shorts selection.
- **All categories:** a shared classification catalog for 27 ORBIT areas plus Other, and a category filter. Existing records retain their saved category IDs.
- **WORKSPACES / SYSTEM:** remove Windows-added environment variables before the first workspace module loads. Keep Node filesystem/process restrictions and the existing minimal environment allowlist. Real-server verification checks the exact environment and denied filesystem/process access. Cleanup waits briefly for Windows file handles to close.
- **INTELLIGENCE:** download existing subscriptions as OPML from Sources. Authenticated, private, no-store response; no feed fetch, remote transfer, model call or change to records. Paused feeds remain in the subscription list; pause state is not part of the portable format. Invalid and credential-bearing URLs are omitted. Specification: https://opml.org/spec2.opml.

## Research and remaining implementation

Confirmed on GitHub during coordination: Claude merged [page watches, PR 370](https://github.com/andreaskuus14/orbit/pull/370) and [receipts, digest, restart recovery and memory reliability, PR 371](https://github.com/andreaskuus14/orbit/pull/371). These are Claude's changes, not features built by this branch. Audit them before starting overlapping CORE, MEMORY, AGENTS or OPERATIONS work. Claude also merged [local captions, IFC and document reading, PR 372](https://github.com/andreaskuus14/orbit/pull/372). All three PRs have been integrated into this branch. Their local service setup and Windows/GPU runtime still need owner-side validation; this branch does not install their models.

The [100-candidate catalog](MODULE-RESEARCH-2026-11-01.md) and [27-category map](CATEGORY-UPGRADE-MAP-2026-11-01.md) are now included on this review branch. Their proposed first upgrades remain candidates unless listed above as built. Some overlap existing ORBIT features and need a code audit before work.

Next audit order: CORE retrieval evidence; MEMORY current versus historical facts; AGENTS verified receipts; OPERATIONS connection failures; goal dependencies; bounded Night Shift scheduling. Then deterministic private LIFE planning, study progress, People identity, VAULT intake, GAME DEV checks, STUDIO quality, REACH source signals, THEATER queues, BUSINESS records, MONEY reconciliation, MARKETS research, ARCH analysis, ANALYTICS outcomes, local voice, phone access, Profile controls, Galaxy accessibility and daily reviews.

Do not install overlapping frameworks merely to satisfy the candidate count. Reuse current storage, authority checks and run infrastructure. LIFE/journal content stays local and out of model inputs. Outside sends, uploads, publishing and spending retain exact-item owner approval.

## Validation

Before the latest batch: 36 focused Idea Radar checks and isolated production build passed. The full gate previously failed in the Windows workspace test. The environment stripping fix now passes all six workspace checks. OPML export, translation coverage and route guards pass six focused checks. The full gate passed: type checking, 3,030 tests (3,026 passed, zero failed, four skipped), synthetic AI evaluation, and isolated production build. Final integration gate also passed after merging main through PR 372: type checking, 3,068 tests (3,064 passed, zero failed, four skipped), synthetic AI evaluation and production build. Build output stayed in .next-idea-radar-check; generated tsconfig edits were discarded.
