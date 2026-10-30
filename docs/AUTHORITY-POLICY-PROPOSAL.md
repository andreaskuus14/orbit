# PROPOSAL (partly superseded): Operate mode for one outward workflow

**Update 2026-10-30: Operator mode adopted for internal work only.** Andreas changed AGENTS.md rule 6: research & build (category A) and organizing his data (category B) now run under standing grants without per-action asks (Profile → Autonomy areas `operator-build` / `operator-organize`, default "Do & report"; policy-pure `operatorAllows`), logged in OPERATIONS → Activity with Undo where possible. **Not adopted:** everything below about outward actions. Sends, publishing, uploads and spending still need his click on the exact item; `setMode("operate")` stays refused and grants still cannot cover consequential actions.

**Status of the rest: PROPOSAL. Nothing below is in effect.** AGENTS.md rule 6 and SAFETY.md §1 still require Andreas's own click on the exact version of every send, spend, publish and signature. The code enforces that today: `authority-pure.ts` refuses to create, load or use a grant that covers a consequential action, and `setMode(..., "operate")` is refused. Only Andreas can apply this proposal, by editing AGENTS.md and SAFETY.md himself and then changing the code checks named below in the same reviewed PR.

## What exists now (Prepare mode)

- Standing grants (`<ORBIT data dir>/authority.json`, Profile → Authority) cover **reversible internal actions only** (approval-pure `EFFECTS` = `"reversible"`), scoped to a workflow (`rule:<id>`, `automation:<id>`, …), optional account/project, with count/money/call limits, a destinations allow-list, an expiry and the policy version.
- Workflow modes: Observe, Prepare, Exception hold. Operate is defined but cannot be switched on.
- One boundary, `authorize(action, ctx)`, for CORE and SDK tool calls, agent approvals, standing rules, automations, and every send/spend/publish/sign path (which the phone Remote, Shortcuts and retries reuse). Each verdict is bound to `POLICY_VERSION`, the grant id and the content hash; a changed binding is refused as stale.

## Proposed AGENTS.md change

Replace rule 6 with:

> 6. Read-only access to outside platforms: no posting, logins or cookies. ORBIT may send a message, spend, publish or sign only
>    (a) after the owner approves that exact version with his own click, or
>    (b) inside a standing grant in **Operate** mode that the owner created himself in Profile → Authority for one named workflow, with a
>    destinations allow-list, a count limit and (for spending) a money limit, an expiry of at most 30 days, and a typed confirmation phrase.
>    Grants never cover signing contracts or Higgsfield spending. Every Operate action is logged, pushed to his phone, held in quiet hours,
>    has a 10-minute cancel window, and stops at once on revoke, Exception hold or Stop-all. Never automatically otherwise.

## Proposed SAFETY.md change (§1, after the table)

> **Operate grants (optional, off by default).** In Profile → Authority you can let one workflow send (or publish) on its own, within a grant you
> write: which workflow, which recipients or channels, how many per day, until when. You switch it on by typing **OPERATE <workflow> WITHOUT ME**.
> It refuses until phone push works. Each action uses the same exact-content fingerprint, the same text check as Auto (numbers, prices, dates,
> promises are held for you), a 10-minute cancel window and a push. Revoke, Hold or Stop-all stops it at the next action. Contracts and
> Higgsfield credits can never be granted.

## Code changes that would come with it (same PR, after the wording above is merged by Andreas)

1. `authority-pure.ts`: bump `POLICY_VERSION`; allow `setMode("operate")` only with the typed phrase and a working push; in `authorize()`, let an active Operate grant cover `outward-send`/`publish` (never `sign`, never `story.approve`) **only** when the grant's destination list contains the exact destination and the content hash is recorded in the decision binding.
2. `newGrant()`: accept outward actions only together with `destinations`, `limits.count` and `expiresAt` ≤ 30 days.
3. Route Operate actions through the existing Auto queue (`autonomy.ts`: cancel window, quiet hours, push), not a new path.
4. Tests: a grant without destinations/limits/expiry is refused; `contracts.sign` and `story.approve` are never grantable; revoke during the cancel window cancels the queued item.
