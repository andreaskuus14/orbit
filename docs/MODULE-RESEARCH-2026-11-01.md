# ORBIT module research — 1 November 2026

Expanded follow-up: [upgrades mapped to every ORBIT category](CATEGORY-UPGRADE-MAP-2026-11-01.md), covering 27 category plans with 108 candidate applications. These reuse specialists where appropriate and are not 108 additional distinct products.

## Findings

ORBIT can benefit from specialist services and better connections between its existing records. A second AI chat platform, another generic agent team, or another task database would mostly duplicate existing work.

This is a broad candidate map, not an exhaustive inventory of the internet or an installation recommendation for every product. Sources are public official documentation and project repositories. Product features were researched; integrations were not built or tested. Priorities, ORBIT applications and effort are my assessment. Hosted/self-hosted editions can differ; verify the exact release, license, Windows deployment requirements, resource use and API coverage before adoption. Open source does not mean unrestricted code reuse or free hosted usage.

Route: **Native** = extend ORBIT; **Connect** = use a specialist service through a narrow adapter; **Study** = borrow a design pattern, not source code. Priority: **P1** = strongest next candidates; **P2** = useful once the foundation exists; **P3** = conditional on real usage. Rows describe proposed ORBIT capabilities; the reference does not necessarily provide the complete proposed workflow.

## Closest systems to study

- [Istota](https://istota.cynium.com/docs/): unusually close personal AI-OS comparison, combining native modules, structured records, durable execution, memory and scheduled work. Study its separation of deterministic modules from the model interface. Its docs identify it as pre-1.0; treat it as a design reference rather than an immediate ORBIT replacement.
- [Twenty](https://twenty.com/): business objects, people, companies, opportunities, views and workflows. Study its connected CRM records.
- [Open WebUI](https://docs.openwebui.com/features/): knowledge retrieval and reusable combinations of tools, instructions and knowledge. ORBIT already has chat, voice, tools and memory; replacement would create substantial overlap.
- [AnythingLLM](https://docs.anythingllm.com/agent-flows/overview): reusable agent flows; its [query mode](https://docs.anythingllm.com/features/chat-modes) is a useful example of answering only from supplied documents.
- [Activepieces](https://www.activepieces.com/docs/getting-started/introduction): connector and flow ecosystem. Potential integration backend, not a reason to replace ORBIT's own authority or task system.
- [Plane](https://docs.plane.so/projects/project-settings): optional project capabilities, intake, cycles, views and releases. Availability varies by edition and plan.

## Candidate catalog: 100 useful modules and upgrades

### A. Shared foundations

| # | Module | Concrete ORBIT benefit | Route | Priority | Reference / condition |
|---|---|---|---|---|---|
| 1 | Integration hub | Show each connected source, scope, last successful sync, failure and disconnect control. | Native | P1 | [Nango](https://nango.dev/docs/getting-started/intro-to-nango) provides an integration-layer reference; a few direct adapters may be simpler for one owner. |
| 2 | Canonical entity links | Connect one company/person to deals, source messages, projects, files and invoices. | Native | P1 | [Twenty](https://twenty.com/). Extend current prospects/People rather than introduce a second CRM database. |
| 3 | Universal intake | Route pasted text, links, documents and supplied transcripts into the existing correct module. | Native | P1 | [Karakeep](https://karakeep.com/) demonstrates multi-format capture. Preserve source and review ambiguous routing. |
| 4 | Source and freshness cards | Every imported claim or metric reveals source ID, observation time and coverage. Unknown is distinct from zero. | Native | P1 | ORBIT-specific design recommendation informed by integration sync patterns in [Nango](https://nango.dev/docs/getting-started/intro-to-nango). |
| 5 | Cross-module saved views | Save views such as overdue client work, this week's publishing, or blockers across projects. | Native | P2 | [Plane](https://docs.plane.so/projects/project-settings). Query existing records instead of copying them. |
| 6 | Module capability registry improvements | Add consistent source freshness, health and visible capabilities to the existing module contract. | Native | P2 | [Istota](https://istota.cynium.com/docs/) and [Open WebUI workspaces](https://docs.openwebui.com/features/workspace/). ORBIT already registers module tools, writes and private results in core-modules-pure.ts; extend that contract and existing skills. |

### B. Business and client delivery

| # | Module | Concrete ORBIT benefit | Route | Priority | Reference / condition |
|---|---|---|---|---|---|
| 7 | Business command center | Combine collected cash, expected recurring fees, overdue invoices, follow-ups and blockers. | Native | P1 | [Twenty](https://twenty.com/); ORBIT already has most underlying records. |
| 8 | Client 360 page | One client page with contacts, communication, agreed scope, delivery and payment history. | Native | P1 | [Twenty](https://twenty.com/). Depends on #2. |
| 9 | Lead capture and qualification | Intake enquiries from your own sites; deduplicate and classify them with source evidence. | Native | P2 | [Activepieces](https://www.activepieces.com/docs/getting-started/introduction) for integration patterns. Public intake needs spam controls and isolation. |
| 10 | Sales conversion reports | Won/lost rate, stage aging, lost reasons and performance by source or offer. | Native | P1 | [Twenty](https://twenty.com/); existing ORBIT funnel and loss reasons provide a start. |
| 11 | Client health and renewal queue | Explain overdue check-ins, unpaid invoices, missed milestones and upcoming renewals. | Native | P2 | Study CRM relationship views; health rules are an ORBIT proposal, not a claim that inactivity proves churn. |
| 12 | Delivery planning and profitability | Milestones, dependencies, time budgets and actual time/cost per engagement. | Native / Connect | P2 | [Plane](https://docs.plane.so/projects/project-settings), [Kimai](https://github.com/kimai/kimai). Start with lightweight time entries. |

### C. Money and commercial operations

| # | Module | Concrete ORBIT benefit | Route | Priority | Reference / condition |
|---|---|---|---|---|---|
| 13 | Statement import and reconciliation | Match imported bank transactions to invoices and expenses; show unmatched items. | Native / Connect | P1 | [Actual Budget imports](https://actualbudget.org/docs/transactions/importing/). CSV/CAMT/OFX support is a useful reference; no bank access assumed. |
| 14 | Categorization rules | Reuse explicit payee/account rules; preview changes before applying broad rules. | Native | P2 | [Actual Budget rules](https://actualbudget.org/docs/transactions/rules/). Keep arithmetic deterministic. |
| 15 | Revenue targets and scenarios | Actual versus target, expected collections and conservative/base/optimistic scenarios. | Native | P1 | Extend ORBIT Money and what-if logic. Forecasts must remain distinct from collected cash. |
| 16 | Recurring expense and renewal register | Track software, domains and service renewals, next charge, owner and purpose. | Native | P2 | ORBIT proposal using imported transactions and explicit recurring records; do not infer a firm obligation from one payment. |
| 17 | Contract signing connection | Track signing status and completed documents alongside existing contract drafts. | Connect | P3 | [Documenso](https://documenso.com/). Verify required signature type and edition; owner signs and approves external sends. |
| 18 | Client-facing delivery portal | A narrow external view of milestones and approved files, separate from the personal OS. | Native / Study | P3 | [FOSSBilling](https://github.com/FOSSBilling) is a billing/client-area reference. Public hosting and access separation make this a separate project. |

### D. Documents, research and knowledge

| # | Module | Concrete ORBIT benefit | Route | Priority | Reference / condition |
|---|---|---|---|---|---|
| 19 | Document inbox and OCR | Search scanned invoices, contracts and PDFs; classify and link them to work. | Connect / Native | P1 | [Paperless-ngx](https://docs.paperless-ngx.com/), [API](https://docs.paperless-ngx.com/api/). Prefer local processing for private material. |
| 20 | Layout-aware extraction | Preserve headings, tables and page references instead of flattening complex PDFs. | Connect | P1 | [Docling](https://docling-project.github.io/docling/). Evaluate sample documents and extraction accuracy first. |
| 21 | Research library and preservation | Save public references with snapshots, reader text, highlights and source URLs. | Native / Connect | P1 | [Karakeep](https://karakeep.com/), [Linkwarden](https://github.com/linkwarden/linkwarden). Choose one storage authority. |
| 22 | Source-only research answers | Answer from selected documents with passage references and an explicit no-evidence outcome. | Native | P1 | [AnythingLLM chat modes](https://docs.anythingllm.com/features/chat-modes). Extend existing ORBIT retrieval. |
| 23 | Visual asset search | Find screenshots, reference photos and footage by content, text and metadata. | Connect / Native | P2 | [Immich search](https://docs.immich.app/features/searching/). A focused creative asset library may be enough; private LIFE media stays out of model pipelines. |
| 24 | Transcript-to-upgrade research | Accept supplied transcripts, identify ideas, compare with current capabilities and deduplicate proposals. | Native | P1 | Extend existing Idea Radar. Add a research mode separate from its freshness-sensitive trend mode. |

### E. Intelligence and opportunity monitoring

| # | Module | Concrete ORBIT benefit | Route | Priority | Reference / condition |
|---|---|---|---|---|---|
| 25 | Public-page change history | Show exactly what changed on competitor, price, documentation or opportunity pages. | Connect | P1 | [changedetection.io API](https://changedetection.io/docs/api_v1/), [history example](https://changedetection.io/tutorial/check-when-website-was-last-updated-and-track-its-changes-over-time). Extend existing watches. |
| 26 | Deadline opportunity radar | Watch public grants, competitions, tenders or architecture opportunities and extract deadlines. | Native | P2 | Built on #25 plus existing Pulse; preserve original eligibility and deadline text. |
| 27 | Search provider adapter | Give research a controlled search interface and provider health reporting. | Connect | P2 | [SearXNG search API](https://docs.searxng.org/dev/search_api.html). Queries still reach upstream engines; exclude private data. |
| 28 | Structured public-site research | Extract consistent product, service and contact facts from public sites. | Connect | P2 | [Firecrawl](https://docs.firecrawl.dev/introduction). Existing hidden browser may already suffice; use an adapter only if extraction improves. |
| 29 | Competitor evidence board | Attach dated changes, sources and your responses to existing competitor reports. | Native | P2 | Extend BUSINESS competitor watch using #25. Avoid another separate news feed. |
| 30 | Domain and site inventory | Link domain, project/client, expiry, DNS and availability information. | Native / Connect | P2 | [Uptime Kuma](https://github.com/louislam/uptime-kuma) for uptime/DNS/certificates; registrar records are needed for renewal settings and costs. |

### F. Content and audience growth

| # | Module | Concrete ORBIT benefit | Route | Priority | Reference / condition |
|---|---|---|---|---|---|
| 31 | Multi-channel publishing adapter | Reuse finished STUDIO assets in channel-specific drafts and publishing queues. | Connect | P2 | [Postiz](https://postiz.com/). Check each network's media/API restrictions; exact-item owner approval stays mandatory. |
| 32 | Campaign links and attribution | Connect a post/video to visits and later enquiries without assuming attribution when missing. | Connect | P2 | [Shlink](https://shlink.io/). Requires a reachable public redirect service, separate from local ORBIT. |
| 33 | Website conversion reporting | Bring campaign, event and conversion metrics into BUSINESS/STUDIO. | Connect | P2 | [Umami](https://docs.umami.is/docs). Start with a few explicit conversion events. |
| 34 | Testimonial and case-study vault | Store source, permission, approved quote, outcome evidence and allowed publishing uses. | Native | P2 | ORBIT-specific proposal; reuse CRM and VAULT. Never generate fictitious endorsements. |
| 35 | Audience feedback and surveys | Collect structured feedback and relate it to content or product work. | Connect | P3 | [Formbricks](https://github.com/formbricks/formbricks). Survey publication and outside messages remain approved actions. |
| 36 | Content asset lineage | Track source footage, rights, script versions, exports, campaign and published outcomes together. | Native | P1 | Extend current STUDIO and VAULT. Postiz is a distribution candidate, not the owner of this data. |

### G. Meetings, communication and planning

| # | Module | Concrete ORBIT benefit | Route | Priority | Reference / condition |
|---|---|---|---|---|---|
| 37 | Approved email/file intake | Link selected email threads and documents to client and project records. | Connect | P1 | [Nango](https://nango.dev/docs/getting-started/intro-to-nango) or narrow direct adapters. Initial scope can be exported files; no browser-cookie access or unattended login. |
| 38 | Meeting transcript inbox | Turn supplied meeting recordings/transcripts into cited decisions and candidate follow-ups. | Native / Connect | P2 | [whisper.cpp](https://github.com/ggml-org/whisper.cpp). ORBIT already has local transcription; reuse it before adding a meeting app. |
| 39 | Booking connection | Relate booked/rescheduled calls to the client record and meeting preparation. | Connect | P3 | [Cal.com](https://cal.com/). External confirmations/reminders must respect ORBIT's approval rule. |
| 40 | Meeting preparation pack | Collect the latest agreement, open questions and recent source-backed history before a call. | Native | P2 | Combines #8, #37 and #38; deterministic gathering plus optional summary of allowed data. |
| 41 | Capacity and weekly planning | Compare project estimates with available work blocks and deadlines. | Native | P2 | [Plane cycles](https://docs.plane.so/core-concepts/cycles), [Kimai](https://github.com/kimai/kimai). Private LIFE text must not enter the model. |
| 42 | Better study scheduling | Evaluate more adaptive spaced repetition and export/import compatibility. | Native / Connect | P3 | [Anki deck options](https://docs.ankiweb.net/manual/deck-options). Existing ORBIT cards already cover the basic use case. |

### H. Agent reliability and reusable work

| # | Module | Concrete ORBIT benefit | Route | Priority | Reference / condition |
|---|---|---|---|---|---|
| 43 | End-to-end trace inspection | Follow a request through retrieval, tools, delegation, latency, failures and outcome. | Connect / Native | P1 | [Langfuse](https://langfuse.com/docs). Redact or omit private payloads; no Journal/LIFE trace export. |
| 44 | Regression experiments | Compare prompt/tool changes against fixed tasks and known failure cases. | Native / Connect | P1 | [Langfuse evaluation](https://langfuse.com/docs). Extend existing evals, replays and scorecards. |
| 45 | Durable long workflows | Resume expensive multi-step work at checkpoints without repeating completed effects. | Native / Study | P2 | [Inngest](https://www.inngest.com/docs/durable-execution), [Trigger.dev](https://trigger.dev/docs). Audit ORBIT's existing durable state and missions before adding a second engine. |
| 46 | Connector-backed recipes | Turn useful external integration sequences into scoped existing ORBIT skills. | Connect / Native | P2 | [Activepieces](https://www.activepieces.com/docs/getting-started/introduction), [AnythingLLM flows](https://docs.anythingllm.com/agent-flows/overview). Do not replace current skill versioning. |
| 47 | Exact-action approval bridge | Prevent connector tools from sending/publishing/spending outside ORBIT's existing approval gate. | Native | P1 prerequisite | [n8n human review](https://docs.n8n.io/build/integrate-ai/ai-examples/human-in-the-loop-for-tools.md) is a pattern reference. Approval must bind content, recipient and effect. |
| 48 | Model provider gateway | Unified API-provider routing, budgets and failover if multiple API models become necessary. | Connect | P3 | [LiteLLM](https://docs.litellm.ai/docs/). Not a drop-in replacement for ORBIT's current CLI bridge; avoid introducing it without a real provider need. |

### I. Development, games and architecture

| # | Module | Concrete ORBIT benefit | Route | Priority | Reference / condition |
|---|---|---|---|---|---|
| 49 | GitHub work feed | Relate issues, PR review state and CI failures to existing tasks and projects. | Connect | P1 | [GitHub webhooks](https://docs.github.com/en/webhooks/about-webhooks). Local PC may need polling or a deliberately configured ingress. Claude still reviews, merges and deploys. |
| 50 | Release and dependency planning | Track feature groups, blockers, acceptance checks and release notes. | Native | P2 | [Plane project settings](https://docs.plane.so/projects/project-settings). Extend existing GAME DEV backlog and missions. |
| 51 | Roblox resource dashboard | Read explicitly supported game resources through scoped official APIs. | Connect | P2 | [Roblox Open Cloud](https://create.roblox.com/docs/cloud). Verify endpoint coverage; do not assume all Creator Dashboard analytics are exposed. Never use account cookies. |
| 52 | Real-playtest evidence | Link actual session findings, bugs and measured observations to releases. | Native | P2 | Extend existing dev sessions and playtests. Keep simulated personas clearly separate from real player results. |
| 53 | IFC import and validation | Read real BIM models, inspect objects and compare them with current ARCH exports. | Connect | P2 | [IfcOpenShell](https://ifcopenshell.org/). ORBIT already exports IFC4; the upgrade is richer interoperability and checking. |
| 54 | BIM quantities and comparison | Compare model versions, quantities and reported clashes with source objects. | Connect / Native | P3 | [IfcOpenShell](https://ifcopenshell.org/). Existing ARCH estimates are learning tools; imported quantities need validation. |

### J. Ownership, operations and presentation

| # | Module | Concrete ORBIT benefit | Route | Priority | Reference / condition |
|---|---|---|---|---|---|
| 55 | Independent availability checks | Monitor ORBIT/client sites and show incidents in existing SYSTEM/Activity. | Connect | P2 | [Uptime Kuma](https://github.com/louislam/uptime-kuma). A monitor on the same PC cannot report while that PC is off. |
| 56 | Backup verification and restore drills | Verify recoverability of local records/files as well as keeping backup snapshots. | Native / Connect | P1 | [restic](https://github.com/restic/restic). Extend existing encrypted backups; use a temporary restore destination. |
| 57 | Selected device file sync | Sync explicit asset/export folders between devices while ORBIT remains the record authority. | Connect | P3 | [Syncthing](https://docs.syncthing.net/). Do not sync live databases/state blindly; sync is not backup. |
| 58 | Demo and presentation mode | Expand synthetic fixtures across business views and suppress sensitive live details. | Native | P2 | Extend existing demo-pure/demo-shell-pure. Blur alone is not data isolation. |
| 59 | Exploratory reporting workspace | Ask ad-hoc questions of curated reporting data without adding a permanent dashboard per question. | Connect / Native | P3 | [Metabase](https://www.metabase.com/docs/latest/). Use a scoped read-only reporting connection and check edition limits. |
| 60 | Reviewed skill catalog | Discover reusable instructions, inspect their sources and map only allowed tools into ORBIT. | Native / Study | P2 | [Skills directory](https://www.skills.sh/). Directory presence/install count is not a code audit; third-party skills cannot grant authority. No specific package was audited or installed in this research. |

## Expansion: 40 additional candidates (#61–100)

These add customer service, equipment, academic work, creative tools and engineering capabilities beyond the original 60. They are distinct work units, but several share a backend and should be delivered together. They are not 100 separate products to install. P1/P2 here is relative to an active workflow: a solo personal OS does not need a support suite or render farm merely because one exists.

### K. Customer service and product feedback

| # | Module | Concrete ORBIT benefit | Route | Priority | Reference / condition |
|---|---|---|---|---|---|
| 61 | Customer support inbox | Turn incoming support requests into tickets linked to client, service and delivery history. Different purpose from the sales pipeline. | Connect | P2 | [Chatwoot](https://www.chatwoot.com/features). Start with imported/read-only conversations; every external response needs the owner's exact-item approval. |
| 62 | Help center and response library | Maintain approved troubleshooting articles and reusable answers grounded in your actual product behavior. | Native / Connect | P2 | [FreeScout modules](https://freescout.net/modules/) include saved replies and a help center. Some modules require paid licenses. Publishing articles remains an outside effect. |
| 63 | Support response deadlines | Show unresolved tickets approaching an agreed response target, business-hour aware. | Native / Connect | P3 | [Chatwoot](https://www.chatwoot.com/features) documents SLA management. Separate a support obligation from a sales follow-up; no invented service guarantee. |
| 64 | Feature request voting | Consolidate repeated user requests, retain demand evidence and connect accepted requests to backlog work. | Connect / Study | P2 | [Fider](https://github.com/getfider/fider). Votes show expressed interest, not guaranteed revenue or representative research. |
| 65 | Incident communication drafts | Prepare a customer-facing outage timeline, maintenance notice and resolution update from confirmed incidents. | Connect / Native | P3 | [Cachet](https://cachethq.io/). Complements uptime monitoring; status publication and subscriber messages require approval. |

### L. Equipment, ownership and materials

| # | Module | Concrete ORBIT benefit | Route | Priority | Reference / condition |
|---|---|---|---|---|---|
| 66 | Equipment register | Track your PC parts, cameras, microphones and other work equipment with serials, purchase evidence and project use. | Native / Connect | P2 | [Snipe-IT](https://snipe-it.readme.io/docs/introduction). A small native register may be simpler than running a full IT asset service. |
| 67 | Warranty and repair history | Connect a device to receipts, warranty dates, service visits and repair documents. | Native | P2 | Study [Snipe-IT](https://snipeitapp.com/product). Proposed ORBIT reminders need verified dates rather than assumptions from purchase age. |
| 68 | Equipment lending and returns | Record who has borrowed an item, its condition, expected return and actual return. | Native / Connect | P3 | [Snipe-IT](https://snipe-it.readme.io/docs/introduction) tracks assignment of assets/accessories. Useful only if you lend gear or manage a team. |
| 69 | Maintenance routines | Schedule equipment cleaning, consumable replacement and checks with completion history. | Native / Study | P3 | [Grocy](https://grocy.info/) is a household-management design reference. Use existing ORBIT rules; LIFE/private household text stays local and out of models. |
| 70 | Parts, materials and purchase planning | Maintain quantities and parts lists for physical builds or architecture models; calculate shortages before buying. | Connect / Native | P3 | [InvenTree](https://github.com/inventree/InvenTree) provides stock/part tracking and a REST API. Procurement planning is internal; orders and spending are not automatic. |

### M. Academic and thinking tools

| # | Module | Concrete ORBIT benefit | Route | Priority | Reference / condition |
|---|---|---|---|---|---|
| 71 | Citation and bibliography manager | Store scholarly metadata and export consistent citations/bibliographies for essays, research and ARCH precedents. | Connect | P2 | [Zotero](https://www.zotero.org/support/creating_bibliographies). Complements the research archive; bibliographic accuracy still needs checking. |
| 72 | Offline reference library | Search selected downloaded manuals and educational collections during outages. | Connect | P3 | [Kiwix](https://get.kiwix.org/en/). Archives have edition dates and can become stale; show those dates in answers. |
| 73 | Course mastery and assessment | Map a course into learning outcomes, exercises, rubrics and evidence of mastery beyond card-review streaks. | Native / Study | P2 | [Moodle features](https://docs.moodle.org/en/Features). Reuse ORBIT School and Study; a full LMS is unnecessary for one learner unless already used. Private LIFE course text must not be sent to a model. |
| 74 | Translation terminology desk | Maintain approved English/Estonian/Russian terminology and side-by-side revisions for business or technical documents. | Native / Connect | P2 | [LibreTranslate](https://docs.libretranslate.com/) is a self-hostable translation API candidate. Glossary/review workflow is an ORBIT proposal; verify needed language pairs and output quality. |
| 75 | Whiteboard and diagrams | Embed editable process maps, client workflows, game systems and architectural concept sketches into projects. | Connect / Native | P2 | [Excalidraw integration docs](https://docs.excalidraw.com/). Store editable scene data and export alongside the project. |

### N. Creative production tools

| # | Module | Concrete ORBIT benefit | Route | Priority | Reference / condition |
|---|---|---|---|---|---|
| 76 | Brand and design token library | Keep colors, typography and spacing consistent across generated sites, thumbnails and client deliverables. | Native / Connect | P1 | [Penpot design tokens](https://help.penpot.app/user-guide/design-systems/design-tokens/). Begin with an explicit brand profile and exportable tokens, not an automatic redesign of ORBIT. |
| 77 | Interactive prototype review | Link navigable prototypes and review comments to acceptance decisions before implementing a client site. | Connect / Study | P2 | [Penpot interface](https://help.penpot.app/user-guide/first-steps/the-interface/) documents prototype, presentation and inspect modes. Complements actual generated-site checks. |
| 78 | Reusable 3D asset workspace | Organize approved materials, objects and poses for GAME DEV/ARCH, with a controlled Blender handoff. | Connect / Study | P2 | [Blender Asset Browser](https://docs.blender.org/manual/en/5.0/editors/asset_browser.html). Library organization is documented; full ORBIT automation requires a separate adapter. |
| 79 | Local generation workflows | Run repeatable local image/texture/creative workflows and return artifacts to STUDIO or GAME DEV. | Connect | P2 | [ComfyUI](https://docs.comfy.org/). Benchmark GPU/VRAM and whitelist workflows; custom nodes are executable dependencies. Hosted routes and models may incur costs. |
| 80 | Audio cleanup workstation | Repair noisy speech, adjust levels and compare processed audio before final export. | Connect / Study | P2 | [Audacity](https://manual.audacityteam.org/). Start with existing ffmpeg processing where adequate; desktop handoff may be simpler than full automation. |
| 81 | Word alignment and speaker labels | Improve caption timing and distinguish speakers in supplied multi-person recordings. | Connect | P2 | [WhisperX](https://github.com/m-bain/whisperX). Language-specific alignment support and diarization model access vary. Benchmark against ORBIT's existing timestamps first. |
| 82 | Manual timeline finishing | Open generated footage and editorial decisions in a full editor for precise creative corrections. | Connect | P2 | [Kdenlive](https://docs.kdenlive.org/en/). Treat as a finishing handoff, not a second STUDIO project database. |
| 83 | Font and usage-rights catalog | Attach font files, license evidence and approved brand usage to deliverables. | Native | P2 | [Google Fonts repository](https://github.com/google/fonts) provides font sources and licensing material; an ORBIT rights catalog is proposed. Each asset's own license governs its use. |
| 84 | Render job scheduling | Queue heavy renders with progress, retry visibility and workstation availability limits. | Connect | P3 | [Flamenco](https://flamenco.blender.org/) is a self-hosted Blender render-management reference. Adapt scheduling ideas; do not assume it directly runs ORBIT's ffmpeg jobs. |
| 85 | 3D asset validation | Detect invalid GLB/glTF files and attach machine-readable issues before a preview or export. | Native / Connect | P1 | [Khronos glTF Validator](https://github.com/KhronosGroup/glTF-Validator). Format correctness does not establish good artistic quality, low polygon cost or Roblox compatibility. |

### O. Product quality, data and infrastructure

| # | Module | Concrete ORBIT benefit | Route | Priority | Reference / condition |
|---|---|---|---|---|---|
| 86 | Feature rollout controls | Enable experimental modules individually and roll back a failing feature without deleting its data. | Native / Study | P2 | [GrowthBook](https://docs.growthbook.io/). Simple local flags may suffice; flags must never bypass authority checks. |
| 87 | Product experiment register | Compare variants of your own sites/products using predefined outcomes and recorded experiment decisions. | Connect / Native | P3 | [GrowthBook](https://docs.growthbook.io/). Different from agent regression evals; meaningful statistical conclusions need sufficient observations. |
| 88 | Application error triage | Group runtime crashes, show affected releases and link actionable errors to repair tasks. | Connect | P1 | [GlitchTip](https://glitchtip.com/documentation/error-tracking/). Complements availability and LLM traces; strip private payloads and source secrets. |
| 89 | Runtime accessibility checks | Catch rendered-page accessibility problems in ORBIT and generated websites beyond current static checks. | Native | P1 | [axe-core](https://github.com/dequelabs/axe-core). Automated checks cover only part of accessibility; keep keyboard/manual review where needed. |
| 90 | Visual regression checks | Compare selected stable views across code changes to catch broken layouts, missing content and overflow. | Native | P1 | [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots). Freeze animations and dynamic data; use stable fixtures. |
| 91 | Load and concurrency testing | Measure queue behavior and API latency under controlled simultaneous requests. | Native / Connect | P2 | [k6](https://grafana.com/docs/k6/latest/). Use a test instance and synthetic data; never stress the live PC or paid model endpoints casually. |
| 92 | API schema and client reference | Define typed request/response contracts for modules and generate readable internal API references. | Native / Study | P2 | [Scalar](https://scalar.com/). Start with local documentation/schema tooling; hosted documentation or MCP publication is not required. |
| 93 | Dependency vulnerability review | Turn relevant dependency advisories into prioritized, evidence-backed upgrade tasks. | Native / Connect | P1 | [OSV-Scanner](https://github.com/google/osv-scanner). Prefer offline/local scans when private dependency metadata must remain local; no automatic production upgrades. |
| 94 | Software bill of materials | Record which packages and artifacts are in each release for inventory and advisory impact analysis. | Connect | P2 | [Syft](https://github.com/anchore/syft). Complements vulnerability review; an inventory does not prove an artifact is safe. |
| 95 | Prompt-injection challenge suite | Test whether malicious source pages/tool results cause unauthorized actions or leak information. | Native / Study | P1 | [garak](https://github.com/NVIDIA/garak) provides LLM vulnerability probes. Add synthetic ORBIT-specific cases to existing evals; no private data or broad unbudgeted scans. |
| 96 | Import data-quality checks | Catch missing IDs, invalid dates, duplicate records and impossible totals before imports affect reports. | Native / Study | P1 | [Great Expectations](https://docs.greatexpectations.io/docs/core/introduction/). Lightweight schema/assertion checks may be enough for ORBIT; a Python service is not required. |
| 97 | Messy-data cleanup preview | Normalize inconsistent company names, tags and CSV columns with repeatable transformations and a reviewable diff. | Native / Connect | P2 | [OpenRefine](https://openrefine.org/docs). Complements import validation; remote reconciliation services must not receive private records. |
| 98 | External API simulator | Exercise timeouts, rate limits, malformed responses and duplicate webhook deliveries without touching real services. | Native / Study | P1 | [WireMock](https://wiremock.org/docs/). Existing local fakes may be simpler; the module is failure simulation, not necessarily a Java service. |
| 99 | Credential lifecycle dashboard | Show which integration owns a credential, its status and known expiry without exposing secret values to CORE. | Native / Study | P2 | [Infisical](https://github.com/Infisical/infisical) is a credential-management reference. Metadata-only first; migration or broader secret access is a separate decision. |
| 100 | Resource and queue metrics | Track memory, render duration, queue depth, request latency and disk pressure over time. | Native / Connect | P2 | [Prometheus](https://prometheus.io/docs/introduction/overview/). Extend existing SYSTEM/performance cards. Numeric telemetry must exclude private labels and is not an exact billing ledger. |

## Highest-value additions from the expansion

- **For client delivery:** #61 support intake when customers need support; #62 grounded response library; #76 reusable brand/design tokens.
- **For STUDIO and GAME DEV:** #79 local creative workflows; #80 audio finishing; #81 improved alignment; #85 3D validation. Existing media processing should be benchmarked before a new dependency is selected.
- **For ORBIT itself:** #88 runtime errors, #89 accessibility, #90 visual regressions, #93 dependency review, #95 adversarial source tests, #96 import quality and #98 API failure simulation.
- **For study and ARCH:** #71 bibliographies and #75 diagrams are relatively focused additions; #73 mastery tracking should extend School/Study rather than create a full LMS.

These priorities do not displace the original recommendation to connect existing records first. Customer-support suites, render farms, equipment lending and controlled experiments are conditional tools, not default requirements for a personal AI OS.

## What ORBIT already has

Code inspected directly during this research and the preceding video comparison:

- `src/lib/business-pure.ts`: prospect stages, expected monthly fees, outreach, follow-up and template reporting.
- `src/lib/prospect-crm-pure.ts`: contact deduplication, timeline events, loss reasons, delivery plan linkage.
- `src/lib/invoices-pure.ts` and `money-pure.ts`: invoices, refunds, expenses, period reporting and distinction between expected and received money.
- `src/lib/morning-pure.ts` and `daily-mission-pure.ts`: briefing and measurable daily actions.
- `src/lib/ideas.ts` and `ideas-pure.ts`: video captions/audio-to-ideas and freshness handling.
- `src/lib/memory-retrieval-pure.ts`: existing hybrid ranking and project hints.
- `src/lib/durable.ts`: persisted sessions, event cursors and durable-write failure reporting; not evidence that every workflow has full step replay.
- `src/lib/skills-pure.ts`: versioned skills, examples, evaluations and tool restrictions.
- `src/lib/automations.ts`: scheduled/event work with existing authority checks and replay deduplication.
- `src/lib/arch-ifc-pure.ts`: existing IFC4 export.
- `src/lib/demo-pure.ts` and `demo-shell-pure.ts`: synthetic demo records and guarded demo fetches.
- `docs/FEATURES.md`: wider documented capabilities, including open loops, night work, projects, STUDIO, health and backups. Documentation is not proof of live configuration or runtime correctness.

## Recommended first implementation sequence

1. **Link existing records and expose freshness** (#1–4). Start with internal records and one selected imported source. Verify duplicates and corrections do not split a client or erase history.
2. **Deliver the business overview and client page** (#7–10, #15). Every number opens evidence. Follow-up and cash labels retain their current meaning.
3. **Improve capture and research** (#19–22, #24). Begin with representative scans and pasted transcripts; measure search correctness and citation usefulness.
4. **Add public-page differences** (#25, #29–30). Only notify meaningful changes; retain before/after evidence. Use existing watch and notification infrastructure.
5. **Improve agent verification** (#43–44, #56). Extend current evals and restore checks before adding more autonomy or background volume.
6. **Add specialist adapters according to actual use**: distribution (#31), attribution (#32–33), finance imports (#13), GitHub (#49), BIM (#53). Do not install the entire catalog.

Each implementation should have one owner-visible acceptance example, a source-of-truth decision, failure/freshness behavior, resource estimate, and required tests. New pure logic belongs in `*-pure.ts` with tests in `tests/`. No REA changes. Work on a new branch, pass `npm run gate` before a PR, and leave merge/deploy to Claude.

## Non-negotiable integration boundaries

- ORBIT remains the command layer and authority gate. A connector is not independently authorized to act.
- Autonomous internal work must follow the standing grants and be logged in Activity, with Undo where possible and Stop-all coverage.
- Sending, publishing, uploading and spending require the owner's click on the exact item. Product defaults or external workflow approvals cannot weaken that rule.
- Never log into outside platforms or reuse browser cookies. Any future approved account connection must use the explicitly established API/import path; research here did not establish one.
- Journal/LIFE text never goes to a model or leaves ORBIT, including through OCR, embeddings, observability or sync defaults.
- Public research requests carry public queries only. No private record text in public search or crawling services.
- Prefer one source of truth per entity. Start one-way/read-only before designing two-way reconciliation.
- Several candidates are substantial Docker/Linux-oriented services. On this Windows PC they can require Docker Desktop/WSL2 or another host, plus maintenance and additional memory. Benchmark before committing to a stack.

## Practical recommendation

Start with native connections between ORBIT's existing records, then evaluate **Paperless-ngx/Docling**, **Karakeep or Linkwarden**, **changedetection.io**, and **Langfuse or equivalent native traces**. Use **Twenty** and **Istota** primarily as design references. Consider **Postiz**, **Umami/Shlink**, **Actual-style imports**, **GitHub**, and **IfcOpenShell** when the associated workflow is active. This preserves ORBIT's strongest asset: one interface over your own work, with evidence and control.
