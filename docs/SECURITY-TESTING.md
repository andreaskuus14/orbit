# Security testing with Strix (isolated copy only)

[Strix](https://github.com/usestrix/strix) (Apache-2.0) runs AI agents that attack a web app like a pentester: they send real
requests, try exploits and report what worked with proof. ORBIT runs it **only against its isolated test copy** (local Supabase in
Docker, fake model CLI, throwaway `@example.test` account, port 3100). The script refuses any other target, refuses if the isolated
stack's markers are missing, and never touches the live ORBIT on the PC.

## Run it (on the PC)

1. Docker Desktop running.
2. `pipx install strix-agent` (Python 3.12+).
3. Set the model in your shell (not in `.env.local`, which the isolated server never reads anyway):
   `STRIX_LLM=anthropic/claude-sonnet-4-5` (or any LiteLLM model string Strix supports) and `LLM_API_KEY=<your key>`.
4. `node scripts/isolated/setup.mjs` (once; builds the isolated copy).
5. `node --experimental-strip-types scripts/isolated/strix.mjs --dry-run` checks the guards and prints the command.
6. `node --experimental-strip-types scripts/isolated/strix.mjs` (add `--quick` for a short scan). It starts the isolated server,
   runs Strix with `scripts/isolated/strix/instruction.md` as its scope, stops the server and prints a severity summary.
   Reports go to `strix-reports/strix_runs/` (gitignored: they contain the throwaway test password).

Strix uses your model key and can take a while; a full scan costs model tokens. Strix's sandbox runs in Docker and must reach
`127.0.0.1:3100`; if it can't from its container on Windows, run the isolated server with `-H 0.0.0.0` only on a firewalled
machine, or use Strix's own networking option, and keep the target guard as it is.

## What it is told to test

Auth and session (incl. the allowed-emails gate), CSRF and approvals (task `seen` fingerprints, ntfy-act tokens), phone pairing
and `/api/remote/*`, file routes (`/w`, VAULT), SSRF through server-side fetches and the hidden browser, CSP and stored XSS. See
`scripts/isolated/strix/instruction.md`.

## From finding to fix

1. Reproduce the finding by hand against the isolated copy with the exact request from the report.
2. Write a failing test first: a unit test in `tests/` for the guard that failed, or an isolated check in `scripts/isolated/`
   when it needs the real signed-in stack.
3. Fix it on its own branch, run `npm run gate`, open a draft PR that quotes the report entry (without the test password).
4. Re-run Strix (`--quick`) to confirm the finding is gone. Never paste live-instance data into a report or PR.
