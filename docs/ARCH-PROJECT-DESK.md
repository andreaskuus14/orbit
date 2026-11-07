# ARCH project desk — first shared workspace

The first increment connects ARCH to the existing OPERATIONS project IDs. The follow-up connects CORE and STUDIO through those IDs; it does not merge existing projects by name or create a third registry.

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

An arbitrary cross-module “continue this project” voice/command-bar command is not integrated yet. Desk notes remain local; this is not a cloud migration. Existing restore tooling has no new one-click importer for desk metadata. Version snapshots retain the existing delayed-save behavior; switching quickly after an edit may preserve the current model without adding that edit as a history snapshot. Imported IFC summaries still do not become editable geometry.

## Follow-up: shared context, files and STUDIO

- **Open project in CORE** explicitly registers a CORE project with the owned OPERATIONS project's ID, then opens its latest listed chat or a new chat in that project. It does not send a message, run a model, copy the desk notes/reference contents, merge older same-named projects or overwrite pinned notes/instructions. CORE project names retain their existing 80-character cap. Chat lookup is limited to the existing newest-chat list; an older chat beyond that list may not be found. Unknown/deleted chats fall back to a new chat in the requested project.
- **Files and visual references** attach existing local VAULT file IDs. Cards resolve current filenames/versions from VAULT metadata, so renames keep the association; removed/unavailable files are shown explicitly. Linked images display local thumbnails, and a palette holds up to 12 colors. Detaching a reference does not delete the original. No file content enters a model prompt. Cloud-only files must first be restored in VAULT before they can be selected here.
- **STUDIO → Projects** uses the same desk and canonical IDs. Link existing production records to a project and open their normal review view. Links can exist in more than one project. Membership does not alter rendering, review, rights, scheduling or publishing, and the general pipeline is not filtered automatically. Existing uploads/credit approvals remain unchanged.
- **Tab recovery** keeps unsaved desk edits, pending references and task text in session storage on a best-effort basis. Recovery happens only after the desk API confirms access. A recovered older revision cannot overwrite newer server notes. Explicit Reload saved notes discards recovered desk edits. Closing the whole browser/tab can still lose session-only recovery; Save remains the durable action.
- **Backup/export** includes this signed-in user's desk metadata under `local.project_desks`, including links, palette and clip/file memberships. Other users' entries are excluded. Linked file bytes remain in the existing VAULT storage; the metadata export is not a new file-copy or restore mechanism.

The follow-up uses release #422 (`a336a0b9`), which includes the merged ARCH desk from PR 377. All 33 focused project checks passed. The follow-up also fixes Windows test harness paths and waits for asynchronous cleanup. It fixes a Stop-all race by signalling live task cancellation before the flag finishes saving. Eleven focused Stop-all checks passed. The full Windows gate passed with 3,315 tests passing, zero failures and four skips. Type checking, the synthetic AI evaluation and the isolated production build also passed.

## Verification

Focused checks cover pure input validation, legacy/scoped storage keys, user/project separation, concurrent saves and stale revisions, corrupt-store preservation, project ownership checks before scene/history reads/writes, rendered desk controls, ARCH save/history behavior, route guards, translations and accessibility. All 22 focused checks passed. The complete required gate passed: type checking, 3,074 tests (3,070 passed, zero failed, four skipped), synthetic AI evaluation and production build. The build used .next-project-desk-check and did not replace the live build. Generated tsconfig edits were discarded. Validation is against branch base 3e8f51bf; the later main-branch local-AI startup change (#375) does not overlap this change. Rendered component checks were used; the live app was not switched to this branch.
