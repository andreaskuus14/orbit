# ARCH project desk — first shared workspace

This first increment connects ARCH to the existing OPERATIONS project IDs. It does not create a third project registry or merge CORE's separate chat-project system.

## Use

Open ARCH and choose an existing project in **Project desk**, or create one. Each project opens a separate editable ARCH model, prices, site settings, named variants and version-history stream. ARCH remembers the last selected project in this browser; on return it checks that the signed-in user still owns the project before opening it.

The desk holds a brief/decisions/next-steps note and up to 50 titled web references. These are stored locally and are not sent to models or fetched automatically. **Save notes and references** is explicit. Project switching is disabled while there are unsaved desk edits, an unfinished reference or task request, or an outstanding model save. Reloading saved notes explicitly discards desk edits; stale writes return a conflict rather than overwriting newer notes. A browser-close warning covers unsaved desk text.

Existing project tasks appear with links to their OPERATIONS detail. **Start task** sends only the typed request to the existing Nova task pipeline with the selected project ID; it does not append the desk notes or reference contents. Existing task permissions/approval handling remains responsible for execution. The list is a snapshot loaded when the desk opens; it is not a live task monitor.

**Unassigned model (existing work)** retains the original browser key and per-user server records. Selecting a project does not move, copy or delete that model. An empty project starts with the standard editable starter scene. Imported IFC summaries and scan/precedent libraries remain their existing features; this increment does not turn an imported IFC into the editable model.

## Storage and boundaries

- Project identity and task membership: existing Supabase `projects` / `tasks` rows.
- Notes and references: `<ORBIT data dir>/project-desks.json`, keyed by authenticated user and project, with exact revision checks and serialized atomic writes. Unreadable/corrupt data is not replaced with an empty store. References can be detached by editing/saving the list.
- ARCH scene and history: existing `arch-scene.json` / `arch-versions.json`, using separate user/project keys. Omitted project parameters preserve legacy records. The browser backup also has a project-specific key.
- Scene/history/desk APIs verify project ownership before touching local records. Malformed project IDs are rejected, and unknown/unowned projects return 404. A failed project model load does not replace it with a starter scene; the user can retry or return to the unassigned model.
- New-project creation and task execution use the existing explicit UI actions. The desk save logs a fixed Activity label, reference count and revision; no note text or links are logged.
- No model installation, dependencies, migrations, REA edits or deployment.

## Remaining scope

CORE chat projects, VAULT attachment membership, image/palette boards, STUDIO project membership and a cross-module “continue this project” command are not integrated yet. Desk notes are local to this installation; this is not a cloud migration. Existing export/restore tooling does not yet include the new desk metadata file. Version snapshots retain the existing delayed-save behavior; switching quickly after an edit may preserve the current model without adding that edit as a history snapshot.

## Verification

Focused checks cover pure input validation, legacy/scoped storage keys, user/project separation, concurrent saves and stale revisions, corrupt-store preservation, project ownership checks before scene/history reads/writes, rendered desk controls, ARCH save/history behavior, route guards, translations and accessibility. All 22 focused checks passed. The complete required gate passed: type checking, 3,074 tests (3,070 passed, zero failed, four skipped), synthetic AI evaluation and production build. The build used .next-project-desk-check and did not replace the live build. Generated tsconfig edits were discarded. Validation is against branch base 3e8f51bf; the later main-branch local-AI startup change (#375) does not overlap this change. Rendered component checks were used; the live app was not switched to this branch.
