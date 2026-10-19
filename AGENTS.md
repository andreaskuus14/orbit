# Rules for AI assistants working on ORBIT

ORBIT is Andreas's personal AI OS (Next.js 15, React 19, R3F, Supabase). The live copy runs on his Windows PC; Claude deploys to it.

1. Never commit to `main`. Make a new branch and open a pull request; Claude reviews, merges and deploys.
2. Never commit secrets: `.env.local` stays local. Add new settings to `.env.example` with empty values only.
3. Do not edit REA files (the owner's reverse-engineering tool and `src/app/api/rea/`). Change code around them.
4. Before a PR: `npx tsc --noEmit -p .`, `npm test` and `npx next build` must pass.
5. Pure logic lives in `*-pure.ts` files with tests in `tests/`.
6. Read-only access to outside platforms: no posting, logins or cookies.
