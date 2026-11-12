# PC trial kit (Windows)

One command per trial, run on the PC that runs ORBIT. Each writes `results/<trial>.md`. Nothing here is installed by ORBIT or listed
in `package.json`; Python tools go into `tools/trials/.venv` (git-ignored). No ORBIT runtime code is touched.

Needs: Node 22+ (same as ORBIT), Python 3.10+, ORBIT running on 127.0.0.1:3000 for trials 2 and 3.

**Signing in for the scripts (trials 2, 3):** ORBIT's API wants your session. In a signed-in tab open DevTools > Network, click any
`/api/...` request, copy the `Cookie` request header, then in PowerShell: `$env:ORBIT_COOKIE = "<paste>"`. It lives only in that window.
Other ORBIT address: `$env:ORBIT_URL`.

## Trial 2: Moonshine voice

1. Read the 20 lines of `clips.txt` aloud (10 EN, 10 ET, with numbers and names). Save 16 kHz mono WAVs as `clips/en/en-01.wav` ... `clips/et/et-10.wav` (Audacity: project rate 16000, mono, export WAV 16-bit). Partial sets work.
2. `.\voice-trial.ps1` (optional `--model moonshine/tiny`; default `moonshine/base`). First run creates `.venv` and runs `pip install useful-moonshine-onnx` inside it.
3. `results/voice-moonshine.md`: WER/CER and median latency per language for ORBIT's current path (`POST /api/voice/transcribe`, local Whisper) and Moonshine, plus per-clip text. A warm-up call is made first so model load is not counted.

Caveats: Moonshine's public models are English; the ET row is expected to be poor and means "unsupported", not "tune it". Digits vs spoken words count as errors for both engines. Interruption handling cannot be measured from clips, so the report ends with a short hand checklist (barge-in, "ORBIT, stop", partial transcripts).

## Trial 3: OpenMontage vs STUDIO

    node studio-vs-openmontage.mjs --script my-script.txt --assets .\assets --om-cmd "<your OpenMontage command>"

- STUDIO side uses the AI Story path (`/api/studio/clips/story`): write, quote, then it **waits for you to type `yes`** at the credit quote (same as the Approve button) and times the render. Without `yes` it only reports the quote. Note: this path makes its own stills/voice and does not take an asset folder, so `--assets` is listed in the report for the OpenMontage side and for the shot-replacement check.
- OpenMontage: install and run it by its own README, **no-key audio path first** (local TTS/music, no API keys), and pass that exact command as `--om-cmd` so it is timed; or omit it and time by hand. Write which keys it needed in the report.
- Output has the pacing / captions / shot replacement / audio / license checklist for you to fill in while watching both videos. Check each tool's voice, music and model licenses against YouTube monetisation.

## Trial 29: Scrapling

    .\scrape-trial.ps1

Installs `scrapling[fetchers]` into `.venv` (and its browsers, `scrapling install`), then compares on `pages.txt` (docs, news, an SPA, Wikipedia, each with expected key strings):
ORBIT's `readArticle` (what `fetch_url` uses: plain fetch, hidden browser when thin), Scrapling `Fetcher`, and Scrapling `DynamicFetcher` (browser rendering).
Only those: no `StealthyFetcher`, no anti-bot/Cloudflare/CAPTCHA bypass. A page that refuses is reported as failed. robots.txt is checked first (pages it disallows are skipped), with 3 s between requests to a host.
Report: completeness vs expected strings, time, link accuracy (up to 5 same-host links per page answer < 400). Edit `pages.txt` freely (tab between URL and keys, `;` between keys).

## Trial 4: code index tools

    node code-index.mjs [--tool Graphify]

1. Verifies each repo and license live from the GitHub API (no install). Graphify (`Graphify-Labs/graphify`, Apache-2.0 when checked) and Codebase Memory MCP (`DeusData/codebase-memory-mcp`, MIT) are pinned in `tools.json`; "Graft" is ambiguous, so the script lists candidates and you pin the right repo.
2. For each tool it **prints the install command and waits for you to type `yes`**, then prints the index/ask commands and waits for a second `yes`. The two .ps1 scripts do the same before any pip install. `index` and `ask` commands in `tools.json` are only what you fill in from each README (empty means "not configured", never guessed); commands run in the ORBIT repo root and `ask` gets the question as `{q}`.
3. Asks the 8 questions in `questions.json` (expected file:line were grep-verified; re-check if the repo moved) and grades the answers, then adds a probe symbol to `src/lib/pure.ts`, asks again without and with re-index (stale-after-edit), and always reverts the file (`git checkout`; skipped if the file has uncommitted changes).
4. Tip: add a plain `git grep` entry as a baseline; it scored 8/8 on the questions in testing, so a tool has to beat that on speed or on harder questions to be worth it.
