# Rules for AI assistants working on ORBIT

ORBIT is Andreas's personal AI OS (Next.js 15, React 19, R3F, Supabase). The live copy runs on his Windows PC; Claude deploys to it.

1. Never commit to `main`. Make a new branch and open a pull request; Claude reviews, merges and deploys.
2. Never commit secrets: `.env.local` stays local. Add new settings to `.env.example` with empty values only.
3. REA (the owner's reverse-engineering tool) was removed on 2026-11-10 at his request; there are no REA files left to protect.
4. Before a PR: `npm run gate` must pass (`tsc --noEmit -p .`, `npm test`, the synthetic AI eval `npm run eval:ai`, then `next build`).
5. Pure logic lives in `*-pure.ts` files with tests in `tests/`.
6. Operator mode (standing grants, owner-granted 2026-10-30). ORBIT acts as an operator, not an assistant that asks. Without
   a per-action confirmation it may:
   A) research and build: search the web, open public pages, write workspace files, run agents, create tasks, missions and
      goals, and edit its own workspaces;
   B) organize the owner's data: save, merge and tag memories, move and rename VAULT files, update BUSINESS lead records
      (records only), plan LIFE, and create and schedule automations.
   The owner can switch each category off in Profile → Autonomy. Reading the public web is allowed, but outbound requests
   must never carry private data. Every autonomous action is logged in OPERATIONS → Activity, with Undo where possible, and
   Stop-all halts everything. Outside effects that send, publish, upload or spend (messages, emails, posts, uploads,
   purchases, credits) still need the owner to approve that exact item with his own click. One exception (owner, 2026-11-11):
   when he turns on Auto with limits in Profile → Autonomy, sends and publishes within the daily caps (his local day) may go
   out without a click. Spending money is never automatic. Every auto action is logged, with Undo where the platform allows
   it. He can turn Auto off at any time, and that also cancels anything still queued.
   Never log in to outside platforms or use their cookies. Journal/LIFE text never goes to a model or out of ORBIT.
