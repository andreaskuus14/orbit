# REA in ORBIT

This integration uses REA 6.5.0's public CLI and shared analysis workflows. CORE's Claude process still has its own tools and inherited MCP servers disabled. No changes to REA are required. This first version supports static JavaScript/TypeScript source-directory analysis, not native decompilers, runtime injection, project editing, or an arbitrary command runner.

## Install on the ORBIT PC

Use the updated files in your existing ORBIT project. Keep your own `.env.local` and assets. In PowerShell:

```powershell
cd C:\Users\andre\Documents\orbit
npm run rea:setup
npm run typecheck
npm run app:rebuild
```

The supplied REA 6.5.0 project is included in `vendor/rea`, with its license and locked dependencies. The installer runs `npm ci --ignore-scripts` and `npm run compile` there. Internet access is needed for dependencies; REA itself comes from the supplied ZIP rather than a registry replacement. It does not install Ghidra, Java or another Node version, or modify another AI client's configuration. Build dependencies are needed even though analysis itself is static; native decompilers are outside this bridge's supported workflow. The matching Windows x64 runtime addon and its manifest are included because static parser workers also require REA's Windows process controls. REA validates the addon's version, architecture and digest before use.

Node must satisfy REA's requirement: 22.x >=22.19, 24.x >=24.11, or 26+. The installer preserves other environment settings, makes a timestamped backup before changing `.env.local`, and sets `ORBIT_REA_ENABLED=true`. It requires a real `ORBIT_ALLOWED_EMAILS` account list; if absent in an interactive terminal, it asks for your sign-in email. Restrict this list to people who may inspect your local projects. An ordinary authenticated user cannot register new targets through the browser or CORE.

## Use it

Open `http://localhost:3000/rea` while signed in. Choose `orbit`, click **Analyze project**, and monitor progress. Use **Cancel analysis**, **Read findings**, or **Download full evidence**. On the evidence reader, choose summary, modules (all graph node kinds), edges, or complete evidence. Filters match literal text in graph nodes/edges; pages are JSON text fragments with explicit character offsets.

You can also ask CORE:

- “Analyze the ORBIT project with REA.”
- “Check REA analysis status.”
- “Read the latest REA findings.”
- “Read the REA modules matching claude.ts.”
- “Cancel the REA analysis.”

An analysis continues in the background if you close the page or stop the chat. Cancel it explicitly through the page or CORE. CORE must not claim a job finished until its status is `done`. Long analyses may need a second chat turn to inspect the results. Status includes a job ID you can use to inspect an older result.

## Register another source project

Only the ORBIT project is registered by default. Add local absolute paths to `.env.local`, then restart ORBIT:

```dotenv
ORBIT_REA_TARGETS_JSON='{"orbit":"C:\\Users\\andre\\Documents\\orbit","notes":"D:\\projects\\notes"}'
```

The default `orbit` target is ORBIT's working directory. The default engine is `vendor/rea/scripts/rea.mjs`; its compiled CLI must exist before status reports it installed. A custom installation can still set `ORBIT_REA_ENTRYPOINT` to the absolute path of REA's `scripts/rea.mjs`, including an earlier separately installed package. This is an operator-controlled executable path, never a model-controlled command. No shell is used for REA execution. A clean, explicit child environment avoids forwarding ORBIT's service credentials. ORBIT starts REA only for an analysis job, supervises it through close and cleanup, and stores its Evidence. There is no second web server or separately started REA service.

The vendor directory is excluded from ORBIT's TypeScript project and source snapshots, so analyzing ORBIT does not recursively analyze the bundled engine. REA keeps its own build configuration and dependencies; ORBIT's existing UI, authentication, CORE dispatch and job APIs remain the integration boundary.

## Coverage and data

REA reads an operation-owned, source-only copy. Supported source extensions include JS, JSX, TS, TSX, MJS, CJS, MTS, CTS, HTML, CSS, Vue and Svelte; REA determines which formats it can parse. Package and TypeScript configuration JSON files are included. Hidden paths, symlinks, dependencies, builds, media, and secret-like filenames are excluded. Snapshotting fails clearly on bounds or changed files instead of claiming complete coverage. Unsupported framework semantics remain REA limitations; this is not a Next.js production execution trace.

Source code may contain hardcoded secrets despite filename exclusions. Review your source before analysis. REA analysis is local, but code/evidence excerpts sent to CORE are sent to your Claude provider for reasoning. Full Evidence, its checksum, and a per-file source manifest are kept under the local data directory's `rea/jobs/<account hash>/<job ID>`. The source copy is removed after completion or failure. The latest ten jobs per account are retained; starting another job prunes older jobs. Export anything you need to keep. One job runs at a time per ORBIT server process; the bound is not a cross-process lock. Run a single ORBIT server for this configuration. A restarted server marks unfinished jobs interrupted; it does not automatically resume them.

Bounds: 2,000 source files, 1 MiB per file, 32 MiB total source and 32 MiB output, eight minutes per job. These are ORBIT resource budgets, not REA completeness guarantees. Files are copied over an interval; stop editing first if you need a consistent review. Same-user hostile filesystem races are outside this integration's isolation boundary.

The bridge never edits your original project. Existing workspace write protection remains: after reading external results, CORE can explain and propose edits but cannot turn those results into writes in the same turn. Review and request a separate implementation step. This release does not add an automatic analyze-then-edit permission bypass.

## Validation

Run `npm test` and `npm run typecheck`. Bridge tests cover snapshots/exclusions, Evidence framing and paging, user/job isolation, the public CLI argument boundary, failure output, real subprocess cancellation, and output bounds using a fixture process. Fixture tests verify ORBIT's integration behavior, not a live REA analysis. See `docs/INTEGRATION-REPORT.md` for checks actually performed on this delivery. Authenticated browser and Claude workflows require your own account configuration.

If installation fails, existing `.env.local` is left unchanged. If REA fails, the job reports failure instead of returning partial success. To disable: set `ORBIT_REA_ENABLED=false` and restart ORBIT. To remove REA, first cancel all analysis jobs and stop ORBIT. The engine and its build dependencies live in `vendor/rea`; evidence lives in the local data directory's `rea` subfolder. Your original source project is not stored there.
