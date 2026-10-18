# ORBIT with bundled REA — 18 October 2026

## Architecture and changes

ORBIT is a Next.js application. Its existing CORE dispatcher already registered four REA tools through `core-rea.ts`; the signed-in `/rea` page and `/api/rea` route use the same job owner in `rea.ts`. That owner snapshots registered source directories, supervises analysis, retains account-scoped Evidence, and handles cancellation and cleanup. REA owns analysis semantics and its public CLI. This delivery connects that bridge to the supplied REA source; it does not add a second dispatcher or server.

- Included supplied REA source, licenses, tests and build configuration in `vendor/rea`. REA analysis source is unchanged.
- Default engine is now `vendor/rea/scripts/rea.mjs`. Explicit entrypoint overrides still work.
- `rea:setup` installs locked build dependencies with lifecycle scripts disabled, compiles the CLI using REA's `compile` script, and enables the bridge. Other environment settings and timestamped backups are preserved.
- Included the exact-version Windows x64 addon and manifest from the REA 6.5.0 release, as documented in REA's Windows README. Static parser workers require this addon too; it was absent from the source ZIP. REA validates version, architecture and digest before loading it.
- Excluded vendor code from ORBIT typechecking. The existing snapshot policy already excludes `vendor`, avoiding recursive engine analysis.
- Check compiled CLI files before reporting the default installation present. Status exposes `busy` through final cleanup.
- Fixed Windows cancellation fallback when `taskkill` starts but returns failure; added the required `NODE_ENV` value to the curated child environment.
- Added a regression for default bundled resolution, an unbuilt engine, CORE dispatch, Evidence and vendor exclusion. Tests wait for cleanup before restoring environment settings.

Existing authentication, CORE flow, UI, read-only snapshots, limits, account separation and custom targets are preserved. CORE exposes static JavaScript/TypeScript project analysis; REA's other capabilities are not newly exposed.

## Verification performed

Environment: Windows x64, Node v24.21.0.

- Locked dependency installation for ORBIT and REA: passed, with lifecycle scripts disabled.
- REA `npm run compile`: passed, with two static/dynamic import bundler warnings.
- ORBIT `npm run typecheck` and setup script syntax check: passed.
- REA bridge tests: **5 passed**. These exercise real subprocess cancellation and fixture-backed jobs, not live REA analysis.
- Full ORBIT suite: **724 tests: 723 passed, 1 failed**. Existing `workspace.test.ts` disk test failed because this sandbox denied a hard link for `.preview-key` (`EPERM`). Workspace implementation was unchanged. The full suite is not green.
- Live, non-fixture sample: **passed** directly through REA's public CLI and through CORE's `rea_status` → `rea_analyze` → `rea_read` dispatch with the default bundled engine. Two TS modules and package metadata were analyzed, full Evidence retained, and expected module names returned. Temporary storage used the writable workspace because the sandbox's default temporary storage denied required operations.
- Standard cached build initially failed without the omitted Windows addon; setup uses direct CLI compilation. A live analysis initially failed without that addon, then passed after matching artifact restoration.

Not verified: authenticated browser/Supabase access, a real Claude conversation, production Next.js build, full-ORBIT analysis, native decompilers, performance comparisons, or the setup script's interactive prompt. The live test uses a small source fixture, not the user's application.

## Start on your PC

Extract the `orbit` folder and copy your existing `.env.local` into it. That file is intentionally absent from the ZIP. Keep your real account in `ORBIT_ALLOWED_EMAILS`. Inside the extracted folder:

```powershell
npm ci
npm run rea:setup
npm run app:rebuild
```

Node must satisfy REA's supported versions: 22.19+ on 22.x, 24.11+ on 24.x, or 26+. Setup needs internet for locked dependencies. Ask CORE “Analyze the ORBIT project with REA” or open `/rea`. The add-on stays disabled until setup succeeds. Dependencies and compiled outputs are omitted from this source delivery.

## Provenance and packaging

Input ZIP SHA-256:

- `orbit.zip`: `7a65c9f399b3bfffebab6ed73f1398e7a404bc27ff1ee99fab6b224a13d90bd2`
- `rea-main.zip`: `97a13742a6e8f8f33423673cd3013e7335bd21403e0226ae1b06da7133c7a111`

Supplemental artifact: `rea-agents@6.5.0` from npm, fetched with `npm pack --ignore-scripts`. Only `native/windows/build/manifest.json` and `rea-windows-x64.node` came from this release; analysis code comes from the supplied source.

- Tarball SHA-256: `531717a06e92ca651aab52691190f916fac044272c01f875e22c5e293218e699`
- Registry integrity: `sha512-C6BG7LyrAdR74mSjertM6PrxJkcNZ2bfQNOJornPo9erDEp2tyPRVYPnV5Yodr+1RqewCQla68WulXlVnveD+A==`
- Addon SHA-256: `665c57ab90aef0712a6aafc423c7992a88bf608bea63b370cb30c695900f9aed`, matched against the included manifest.

Packaging omits credentials, installed dependencies, generated builds/caches, machine logs/PIDs, old integration backups and the stale `ORBIT-full-code.md` export. App source, public assets and Supabase migrations are included. The previous changes report is replaced so historical test claims are not mistaken for this delivery's results. Original input ZIPs were not modified.

## Local installation follow-up

The project was subsequently updated in C:\Users\andre\Documents\orbit after backing up replaced files and checking for conflicting local edits. Existing settings were preserved; ORBIT_REA_ENABLED was enabled with a separate local environment backup. A production Next.js build passed in .next-orbital-update, without touching the currently served release. A live three-file analysis through CORE also passed from the installed folder.

The setup script now removes inherited npm allow-scripts command configuration before invoking nested npm, avoiding EALLOWSCRIPTS. This session then encountered a Windows permission error during dependency extraction; the already tested locked dependency tree and compiled runtime were copied into the installed engine instead. That installed engine passed the live test. The complete interactive installer has not been verified end to end.

The existing Windows launcher independently detected the source changes and activated a new production release (SC1z1Gn9O7huOeauTYOWP), confirmed by its log and live health endpoint. REA was enabled after that server started, so a final restart is needed to load the new setting. Run Finish-Orbital-Update.cmd (or npm run app:rebuild) in the normal Windows session. This sandbox could not reliably inspect/control the existing Windows processes and did not stop them.
