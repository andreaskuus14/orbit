# ORBIT: upgrades for every category

Research date: 1 November 2026. Companion to [the 100-module catalog](MODULE-RESEARCH-2026-11-01.md).

## Scope and interpretation

This map covers all functional headings in `docs/FEATURES.md`, plus the important subcategories visible in ORBIT's module registry and code: CORE, MEMORY, INTELLIGENCE, AGENTS, OPERATIONS, Goals/Missions, Night Shift, LIFE, School, People, VAULT, Workspaces/DEV, GAME DEV, STUDIO, REACH, THEATER, BUSINESS, Money, MARKETS, ARCH, ANALYTICS, Voice/Local AI, Phone, Profile, Galaxy, System, and daily/weekly routines.

There are **27 category plans and 108 candidate applications** below. These are not 108 new distinct products: a specialist can support several categories, and several entries extend capabilities already present. The preceding catalog remains 100 distinct module/upgrade proposals. This document maps potential upgrades to actual ORBIT areas rather than inflating that count.

Public official documentation and project repositories establish the referenced tools' capabilities. The ORBIT applications, priorities and suggested first steps are design recommendations. No candidate was installed or benchmarked, and current configuration of the live app was not verified. Paid, hosted and community editions can differ; confirm license, API coverage and Windows requirements before implementation. Research sources are linked beside each candidate.

**Connect:** a bounded API/file adapter to a specialist. **Adapt:** implement the useful pattern inside ORBIT. **Evaluate:** benchmark or prototype before selecting it. Default to one source of truth, minimal new infrastructure and extending current features.

## 1. CORE — context and useful answers

Already present: module-aware tools, live status, sessions, memory retrieval, authority checks and local fallback.

- **Letta — adapt:** explicit bounded memory blocks for durable project context, separate from incidental chat. [Stateful-agent concepts](https://docs.letta.com/v1-sdk/concepts/stateful-agents).
- **Haystack — evaluate:** composable retrieval and ranking experiments against a fixed set of ORBIT questions. [Documentation](https://docs.haystack.deepset.ai/docs/intro).
- **AnythingLLM — adapt:** a source-only answer mode that clearly reports insufficient evidence. [Chat modes](https://docs.anythingllm.com/features/chat-modes).
- **Open WebUI — adapt:** clearer combinations of model instructions, knowledge and tools for each work mode. [Workspace](https://docs.openwebui.com/features/workspace/).

**First upgrade:** a visible context/evidence inspector: what CORE retrieved, why, source age and which module it used. Evaluate correctness before changing frameworks.

## 2. MEMORY — temporal facts and research recall

Already present: hybrid retrieval, beliefs, episodes, source handling and graph-related code. A new memory platform would overlap substantially.

- **Graphiti — evaluate:** time-aware facts and relationships, including superseded information and historical queries. [Overview](https://help.getzep.com/graphiti/getting-started/overview).
- **Karakeep — connect/adapt:** preserved public references, searchable saved content and highlights. [Product](https://karakeep.com/).
- **Zotero — connect:** scholarly metadata, citations and bibliography exports. [Documentation](https://www.zotero.org/support/creating_bibliographies).
- **Linkwarden — evaluate as an alternative to Karakeep:** preserved pages and annotated reference collections. [Repository](https://github.com/linkwarden/linkwarden).

**First upgrade:** query current versus historical facts with original evidence. Choose one reference archive backend; do not run competing copies of all memory.

## 3. INTELLIGENCE — feeds, changes and research quality

Already present: Pulse, sourced briefings, RSS ingestion and monitoring.

- **Miniflux — connect/adapt:** feed management, OPML, full-text extraction and a reader workflow. [Features](https://miniflux.app/features.html).
- **FreshRSS — alternative:** configurable self-hosted feed aggregation rather than rebuilding feed administration. [Project](https://freshrss.org/).
- **changedetection.io — connect:** retained before/after versions of important public pages. [API](https://changedetection.io/docs/api_v1/).
- **SearXNG — evaluate:** a controlled public-query search interface. [Search API](https://docs.searxng.org/dev/search_api.html).

**First upgrade:** combine briefing items with source freshness, saved queries and meaningful page changes. Choose one feed backend, preserving Pulse's citation checks.

## 4. AGENTS — reliable roles and verifiable results

Already present: role agents, delegation, tool restrictions, replay/evals and scorecards.

- **LangGraph — evaluate:** explicit state transitions and resumable agent graphs. [JavaScript overview](https://docs.langchain.com/oss/javascript/langgraph/overview).
- **Langfuse — connect/adapt:** traces that show retrieval, tools, latency and outputs. [Documentation](https://langfuse.com/docs).
- **garak — adapt:** synthetic malicious-source and tool-output challenges. [Repository](https://github.com/NVIDIA/garak).
- **Letta — study:** persistent role context rather than resending everything without clear ownership. [Stateful agents](https://docs.letta.com/v1-sdk/concepts/stateful-agents).

**First upgrade:** an agent receipt showing requested outcome, actual changes, verification evidence and remaining failures. Expand existing evals before selecting another agent runtime.

## 5. OPERATIONS — execution and integrations

Already present: projects, tasks, automations, durable cursors, approvals and Activity.

- **Activepieces — connect/evaluate:** reusable external connector flows. [Introduction](https://www.activepieces.com/docs/getting-started/introduction).
- **Windmill — evaluate:** code-backed scripts, jobs and workflows. [Introduction](https://www.windmill.dev/docs/intro).
- **Nango — evaluate:** account connection, token management and sync infrastructure. [Introduction](https://nango.dev/docs/getting-started/intro-to-nango).
- **Budibase — study:** bounded operational forms and request views over existing data. [Introduction](https://docs.budibase.com/docs/what-is-budibase).

**First upgrade:** source connection status plus a reusable run inspector and failed-import queue. Select a connector strategy after prototyping one real source, not all four platforms.

## 6. GOALS AND MISSIONS — completion and dependencies

- **Plane — adapt:** milestones, dependencies, intake and release groups. [Project settings](https://docs.plane.so/projects/project-settings).
- **Vikunja — adapt:** clear task relationships, subtasks and due-date views. [Features](https://vikunja.io/features/).
- **Inngest — evaluate:** waiting for events and resuming durable steps. [Durable execution](https://www.inngest.com/docs/durable-execution).
- **Trigger.dev — alternative:** background task execution patterns. [Documentation](https://trigger.dev/docs).

**First upgrade:** dependency-aware mission steps with a concrete acceptance check and resume point. Preserve existing mission records and authority handling.

## 7. NIGHT SHIFT — bounded background work

- **Windmill — study:** observable worker jobs and execution controls. [Documentation](https://www.windmill.dev/docs/intro).
- **Inngest — study/evaluate:** checkpoint expensive completed steps rather than replay whole jobs. [Durability](https://www.inngest.com/docs/durable-execution).
- **Prometheus — connect/adapt:** queue depth, duration and resource metrics. [Overview](https://prometheus.io/docs/introduction/overview/).
- **restic — connect/evaluate:** backup snapshots and verification supporting recoverable overnight work. [Repository](https://github.com/restic/restic).

**First upgrade:** a nightly queue ordered by useful output, budget, prerequisites and PC resource availability. Existing Stop-all applies to every lane.

## 8. LIFE — private planning and routines

All LIFE and journal content stays inside ORBIT and out of model inputs. References here primarily inform native deterministic features. An external service connection would need a separate data-boundary decision; it is not authorized by this research.

- **Vikunja — adapt locally:** recurring tasks, deadlines and clear dependencies. [Features](https://vikunja.io/features/).
- **Mealie — study:** recipe organization, meal planning and shopping-list workflows. [Documentation](https://mealie.io/).
- **Grocy — study:** stock and routine-management patterns for household organization. [Project](https://grocy.info/).
- **ActivityWatch — study:** local activity summaries as an optional aid to focus planning. [Documentation](https://docs.activitywatch.net/en/latest/).

**First upgrade:** a deterministic local planning view that handles recurring obligations and overload without sending private text to a model. Activity capture, if ever used, must be explicit and narrowly scoped.

## 9. SCHOOL AND STUDY — evidence of learning

- **Anki — evaluate/adapt:** adaptive spaced repetition and interoperable card workflows. [Deck options](https://docs.ankiweb.net/manual/deck-options).
- **Moodle — study:** learning outcomes, rubrics and assessments beyond task completion. [Features](https://docs.moodle.org/en/Features).
- **Zotero — connect for allowed research material:** source metadata and bibliography management. [Documentation](https://www.zotero.org/support/creating_bibliographies).
- **Kiwix — connect for public reference material:** offline educational collections. [Overview](https://get.kiwix.org/en/).

**First upgrade:** link each study objective to public/reference material, practice and demonstrated progress. Extend existing School/Study. Any course content classified as LIFE remains excluded from model/external processing.

## 10. PEOPLE — relationships without duplicate identities

- **Monica — study:** personal relationship timelines and reminders. [Project](https://www.monicahq.com/en/). Distinguish released features from its announced v3 plans.
- **Twenty — adapt:** one person linked to multiple companies/opportunities. [Product](https://twenty.com/).
- **Radicale — evaluate for approved contacts:** CardDAV interoperability. [Documentation](https://radicale.org/v3.html).
- **Cal.com — connect for approved work bookings:** associate appointments with known contacts. [Product/API entry points](https://cal.com/).

**First upgrade:** stable person identity across People and BUSINESS, with explicit private/work boundaries. Private relationship notes are not sales-research context.

## 11. VAULT — find and recover files

- **Paperless-ngx — connect/evaluate:** OCR, document classification and searchable records. [Documentation](https://docs.paperless-ngx.com/).
- **Docling — connect/evaluate:** structured PDF/document extraction preserving tables and headings. [Documentation](https://docling-project.github.io/docling/).
- **Immich — evaluate for allowed creative media:** image/video metadata and content search. [Search](https://docs.immich.app/features/searching/).
- **restic — evaluate:** recoverable file snapshots rather than synchronization alone. [Repository](https://github.com/restic/restic).

**First upgrade:** document intake, provenance and OCR, with original files preserved. Exclude LIFE/journal paths from all ingestion, embedding and model workers.

## 12. WORKSPACES AND DEV — better generated deliverables

- **Docker isolation — evaluate:** constrained execution environments for generated code rather than executing it on the host by default. [Security documentation](https://docs.docker.com/engine/security/).
- **Playwright — extend:** stable fixtures and visual regressions on generated sites and ORBIT views. [Visual comparisons](https://playwright.dev/docs/test-snapshots).
- **axe-core — connect:** rendered-page accessibility checks beyond static linting. [Repository](https://github.com/dequelabs/axe-core).
- **Storybook — evaluate:** reusable component examples and testable UI states. [Documentation](https://storybook.js.org/docs).

**First upgrade:** deliverable checks with screenshots, accessibility results and failure receipts. Existing workspace safety, offline previews and site repair loops remain foundations.

## 13. GAME DEV — Roblox engineering workflow

- **Rojo — evaluate:** source-file/Studio synchronization and a more reviewable development workflow. [Repository](https://github.com/rojo-rbx/rojo).
- **Wally — evaluate:** explicit, versioned Roblox dependencies. [Project](https://wally.run/).
- **Selene — evaluate:** Lua/Luau-oriented lint feedback before offering a fix. [Documentation](https://kampfkarren.github.io/selene/).
- **Lune — evaluate:** Luau tooling outside Studio and supported model/place-file operations. [Documentation](https://lune-org.github.io/docs/).

**First upgrade:** a read-only source quality report attached to dev sessions/backlog. Lune is not a full Roblox game engine; verify each tool against the project's Luau version. Studio writes and publishing are separate controlled actions.

## 14. STUDIO — production quality and distribution

- **ComfyUI — evaluate:** approved local asset-generation workflows. [Documentation](https://docs.comfy.org/).
- **WhisperX — benchmark:** caption alignment and speaker labels. [Repository](https://github.com/m-bain/whisperX).
- **Kdenlive — connect by files:** precise manual finishing of generated content. [Manual](https://docs.kdenlive.org/en/).
- **Postiz — evaluate:** channel-specific drafts and distribution adapters. [Product](https://postiz.com/).

**First upgrade:** a shared asset/brand package and quality review across script, sound, captions and export. Upload/publish/spend always require exact-item owner approval.

## 15. REACH — public audience and trend signals

Already present: public-source adapters including Bluesky, Twitch, Reddit and Kick. These candidates deepen existing integrations.

- **Bluesky APIs — extend:** scoped public feeds, topics and observations. [Documentation](https://bsky.network/).
- **Twitch API/EventSub — evaluate:** supported stream events instead of unnecessary repeated polling. [Documentation](https://dev.twitch.tv/docs/api/).
- **Miniflux — adapt/connect:** organized creator/publication subscriptions. [Features](https://miniflux.app/features.html).
- **changedetection.io — connect:** public-page evidence of emerging offers and announcements. [API](https://changedetection.io/docs/api_v1/).

**First upgrade:** topic/creator watchlists with timestamps, historical baselines and actionable changes. Public visibility is evidence of attention, not proof of commercial demand.

## 16. THEATER — owned media and learning playback

- **Jellyfin — connect/evaluate:** browse and play an owned media library. [Documentation](https://jellyfin.org/docs/).
- **Audiobookshelf — connect/evaluate:** audiobooks, podcasts and playback progress. [Documentation](https://audiobookshelf.org/docs/documentation/introduction/).
- **mpv — evaluate:** dependable local media playback and scripting interfaces. [Manual](https://mpv.io/manual/stable/).
- **PeerTube — evaluate:** supported federated/public or self-hosted video sources. [Documentation](https://docs.joinpeertube.org/).

**First upgrade:** one queue for supported media with resume position and deliberate saved learning moments. Do not assume DRM services or all YouTube playback restrictions can be bypassed.

## 17. BUSINESS — connected sales and client work

- **Twenty — adapt/evaluate:** company/person/deal relationships and useful views. [Product](https://twenty.com/).
- **Chatwoot — connect when support exists:** support intake linked to the client. [Features](https://www.chatwoot.com/features).
- **Cal.com — connect:** booking events and call preparation. [Product](https://cal.com/).
- **Documenso — evaluate:** signing status connected to existing contract records. [Product](https://documenso.com/).

**First upgrade:** Client 360 and a business overview using existing prospects, projects and invoices. Do not introduce a second CRM as the first step.

## 18. MONEY — collections, expenses and profitability

- **Actual Budget — adapt/evaluate:** statement import, duplicate handling and classification rules. [Imports](https://actualbudget.org/docs/transactions/importing/).
- **Kimai — connect/evaluate:** time records linked to engagement profitability. [Repository](https://github.com/kimai/kimai).
- **Paperless-ngx — connect:** supporting receipts and invoice documents. [API](https://docs.paperless-ngx.com/api/).
- **Metabase — evaluate:** read-only reporting on curated financial records. [Documentation](https://www.metabase.com/docs/latest/).

**First upgrade:** previewable statement reconciliation with unmatched items. Preserve separate labels for expected fees, issued invoices, collected cash and profit. No bank credentials or financial records are sent to public research services.

## 19. MARKETS — data and paper analysis

- **OpenBB — evaluate:** research data adapters and analytical interfaces. [Documentation](https://docs.openbb.co/).
- **Ghostfolio — evaluate:** portfolio tracking and composition analysis. [Repository](https://github.com/ghostfolio/ghostfolio).
- **Portfolio Performance — evaluate/file exchange:** desktop performance and allocation analysis. [Project](https://www.portfolio-performance.info/en/).
- **Backtesting.py — evaluate:** historical tests for the existing paper/simulation context. [Repository](https://github.com/kernc/backtesting.py).

**First upgrade:** consistent source/price timestamps and reproducible paper-performance reports. Data-provider availability, fees, currency, splits and dividends need explicit handling; historical fit is not a live execution system.

## 20. ARCH — interoperability and environmental analysis

- **IfcOpenShell — evaluate:** import/validation and object-level quantities beyond current IFC export. [Project](https://ifcopenshell.org/).
- **Speckle — evaluate:** model exchange and object-based review between design tools. [Documentation](https://docs.speckle.systems/quickstart/welcome).
- **Ladybug Tools — evaluate:** climate, daylight and environmental design workflows. [Project](https://www.ladybug.tools/).
- **OpenStudio — evaluate:** structured building-energy models using established simulation tools. [Repository](https://github.com/NREL/OpenStudio).

**First upgrade:** import a representative IFC and validate what ORBIT retains; then prototype one environmental-analysis handoff. Do not relabel current learning estimates as validated professional analysis.

## 21. ANALYTICS — outcomes and quality

- **Umami — connect for your sites:** campaign and conversion reporting. [Documentation](https://docs.umami.is/docs).
- **Metabase — evaluate:** ad-hoc analysis over curated reporting data. [Documentation](https://www.metabase.com/docs/latest/).
- **Langfuse — evaluate:** agent prompt/trace experiments and quality metrics. [Documentation](https://langfuse.com/docs).
- **GrowthBook — evaluate when traffic supports it:** explicit product experiments and flags. [Documentation](https://docs.growthbook.io/).

**First upgrade:** a small metric dictionary with source, denominator, observation window and drill-through. Keep business outcomes separate from model-call volume and simulated results.

## 22. VOICE AND LOCAL AI — lower-latency offline interaction

Already present: local Whisper, Kokoro, Ollama fallback and local tool modules. Candidates require comparison, not automatic replacement.

- **sherpa-onnx — benchmark:** local speech recognition and speech-related runtimes. [Documentation](https://k2-fsa.github.io/sherpa/onnx/).
- **Piper — benchmark:** alternative local TTS engine and voice availability. [Repository](https://github.com/OHF-Voice/piper1-gpl).
- **openWakeWord — benchmark:** offline wake detection and false-activation controls. [Repository](https://github.com/dscripka/openWakeWord).
- **ONNX Runtime — evaluate where applicable:** local inference and hardware acceleration. [Documentation](https://onnxruntime.ai/docs/).

**First upgrade:** a benchmark with English/Estonian samples, wake false positives, interruption behavior and time to first speech. Check engine and individual-model licenses separately.

## 23. PHONE, WATCH AND REMOTE ACCESS

- **Home Assistant Companion — study:** device-aware notification, widget, watch and car interaction patterns. [Architecture](https://contributors.home-assistant.io/companion/). Not a plug-in replacement for ORBIT Remote.
- **ntfy — evaluate:** an alternative notification delivery route. [Documentation](https://docs.ntfy.sh/).
- **Gotify — alternative, platform-dependent:** self-hosted push delivery and APIs. [Documentation](https://gotify.net/docs/). Verify actual iPhone delivery needs before selection.
- **Tailscale Serve — extend existing setup:** private HTTPS reachability to local services. [Documentation](https://tailscale.com/docs/features/tailscale-serve).

**First upgrade:** resilient reconnect, minimal notification contents and a focused Needs-you view. Existing pairing, approval and car-mode restrictions remain. Sensitive text must not enter notification payloads by default.

## 24. PROFILE, AUTONOMY AND PREFERENCES

- **Supabase MFA — evaluate:** stronger authentication integrated with current auth rather than an identity-platform replacement. [Documentation](https://supabase.com/docs/guides/auth/auth-mfa).
- **i18next — evaluate:** structured language resources and translation coverage. [Documentation](https://www.i18next.com/).
- **Infisical — study:** connection/credential ownership and lifecycle visibility without displaying secrets. [Repository](https://github.com/Infisical/infisical).
- **Radix Primitives — adapt selectively:** accessible settings controls and dialogs. [Documentation](https://www.radix-ui.com/primitives/docs/overview/introduction).

**First upgrade:** clear settings for each module's data use, capabilities and health, with export/revocation information. The current module registry already declares tools, writes and private results; extend it instead of inventing another registry.

## 25. GALAXY AND GENERAL UI

- **React Three Fiber guidance — apply:** demand rendering and adaptive performance where suitable. [Performance documentation](https://r3f.docs.pmnd.rs/advanced/scaling-performance).
- **Penpot — adapt:** reusable visual tokens and consistent module layouts. [Tokens](https://help.penpot.app/user-guide/design-systems/design-tokens/).
- **Radix Primitives — evaluate selectively:** keyboard/focus behavior for complex controls. [Documentation](https://www.radix-ui.com/primitives/docs/overview/introduction).
- **Storybook — evaluate:** inspect consistent idle/loading/empty/error/approval states for module UI. [Documentation](https://storybook.js.org/docs).

**First upgrade:** faster low-power mode with equivalent 2D access, and consistent module status/error patterns. Keep ORBIT's identity; avoid adding animation that communicates no real state.

## 26. SYSTEM, SAFETY AND RECOVERY

- **Uptime Kuma — connect:** independent availability and certificate monitoring. [Repository](https://github.com/louislam/uptime-kuma).
- **GlitchTip — connect/evaluate:** grouped application errors and affected releases. [Documentation](https://glitchtip.com/documentation/error-tracking/).
- **restic — evaluate:** encrypted snapshot recovery and restore verification. [Repository](https://github.com/restic/restic).
- **Gitleaks — evaluate:** local secret scanning in code/history. [Repository](https://github.com/gitleaks/gitleaks).

**First upgrade:** a demonstrated temporary restore and a useful incident record. Keep private payloads out of logs, and distinguish a same-PC monitor from one that can detect that PC going offline.

## 27. MORNING, EVENING AND WEEKLY REVIEW

- **ActivityWatch — study:** optional local activity aggregates for comparing planned versus actual focus. [Documentation](https://docs.activitywatch.net/en/latest/).
- **Vikunja — adapt:** due-work and recurring-task presentation. [Features](https://vikunja.io/features/).
- **Metabase — study:** understandable metric drill-through and saved views. [Documentation](https://www.metabase.com/docs/latest/).
- **Home Assistant Companion — study:** notification timing, mobile surfaces and glanceable device experiences. [Architecture](https://contributors.home-assistant.io/companion/).

**First upgrade:** a deterministic daily stack of decisions, blockers, deadlines and verified wins from existing records. Private LIFE summaries must remain local and never be passed to a model or notification service.

## Coverage of registry modules and protected tools

The CORE registry includes additional names that are workflows inside the areas above, rather than separate planets:

| Registry area | Covered here |
|---|---|
| ORGANIZE | OPERATIONS, LIFE, BUSINESS and entity linking |
| IDEAS | MEMORY, INTELLIGENCE, STUDIO and the existing transcript-to-upgrade proposal |
| HIGGSFIELD | STUDIO: keep quote/approval flow; local alternatives are candidates, not replacements |
| DEALS | MARKETS opportunity monitoring and existing public-page watches; no automatic buying |
| RULES | OPERATIONS, Night Shift and daily routines |
| LOCALAI | Voice/Local AI, STUDIO and GAME DEV |
| WEEK | Daily/weekly review |
| CHECKPOINT | Goals/Missions and Night Shift |
| LOAD | CORE's existing module discovery/selection |
| REA | Protected by AGENTS.md: no edits, replacement or expansion of its tool code proposed |

## Category-wide rollout recommendation

**First pass: establish a useful baseline in every category.** Give each category one evidence-backed status, one clear primary workflow, empty/loading/error states, source freshness where applicable, and a measurable acceptance example. The current registry already supplies part of this contract. This is preferable to deploying 27 new services at once.

**Second pass: prototype the weakest categories.** MARKETS data quality, THEATER resume/library access, SCHOOL source management, ARCH import, voice latency and phone reliability received more specific candidate coverage in this search. Select representative real tasks with allowed data and compare against the current implementation.

**Third pass: add specialist services selectively.** Likely shared services to evaluate include document OCR/extraction, public-page change tracking and traces/errors. A single service may improve several categories. Choose alternatives against each other; do not install all candidates.

**Fourth pass: measure cross-category outcomes.** Useful questions include time to find a document, accuracy of cited answers, overdue work discovered, accepted drafts, caption correction time, successful restores, phone reconnect reliability and render latency. Existing ORBIT evals and outcome metrics should remain the baseline.

## Implementation boundaries

- This is research, not authorization to connect accounts, publish, upload or spend. Future outside effects still require the owner's click on the exact item.
- Autonomous allowed internal work stays logged in Activity, offers Undo where possible and obeys Stop-all.
- No outside login or browser-cookie reuse. Approved future integrations must have a deliberate API or file-import route.
- LIFE/journal privacy applies to search, embeddings, tracing, exports, sync, voice and background workers, not only CORE chat.
- No REA file changes. New code uses a branch and tests appropriate to the change; `npm run gate` must pass before a PR, and Claude reviews/merges/deploys.
- Model/voice/asset licenses are separate from engine licenses. Hosted availability is separate from self-hosted availability. Windows deployment can require WSL2/Docker or a separate host.
- No new tool is presumed better merely because it is popular. Benchmark a specific ORBIT task, keep the simplest successful option and remove the prototype if it adds no value.
