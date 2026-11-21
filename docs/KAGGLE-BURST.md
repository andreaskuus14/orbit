# Kaggle burst

A GPU job that won't fit on the laptop's 8 GB RTX 5060, or would take too long there, can run on your free Kaggle account.
Local always comes first. Nothing goes to Kaggle until you click **Send to Kaggle** (twice) in OPERATIONS → Local AI → Kaggle burst.

## One-time setup (laptop)

```powershell
powershell -ExecutionPolicy Bypass -File tools\kaggle\setup.ps1
```

It installs the official Kaggle CLI (`kaggle` 2.2.5, Apache-2.0) into `tools\kaggle\.venv`. The first time, it opens
kaggle.com/settings/api. Click **Create Legacy API Key**, move the downloaded `kaggle.json` to `%USERPROFILE%\.kaggle\kaggle.json` and run
the script again. It prints your weekly GPU hours (`kaggle quota`) and sets `ORBIT_KAGGLE_CLI` in `.env.local`. Restart ORBIT after that.
On kaggle.com, verify your phone number too: Kaggle only lets scripts use a GPU and the internet after that.

The token stays only in `%USERPROFILE%\.kaggle`. It never goes into the repo, `.env.local`, Supabase or any log. ORBIT only checks that
the file is there and reads its `username` field (for the script's address). The Kaggle CLI reads the key itself.

## What Kaggle gives (from Kaggle's docs, checked 2026-11-21)

- Free GPU: one P100 or two T4s (16 GB each). ORBIT asks for `NvidiaTeslaT4` and uses one card.
- Weekly GPU quota: "30 hours or sometimes higher depending on demand and resources". It resets weekly. ORBIT reads the real
  numbers with `kaggle quota`. If they can't be read, it counts its own runs over a rolling 7 days against `ORBIT_KAGGLE_WEEKLY_HOURS` (default 30).
- At most 12 h per run, 20 GB of output in `/kaggle/working`.

## How a job goes

1. A tool (today: CORE's `local_video`) asks `decide()`. If it fits on this PC and finishes within `ORBIT_KAGGLE_LOCAL_MAX_MIN`
   (default 30 min), it runs locally as before. If it needs more GPU memory than `ORBIT_LOCAL_VRAM_GB` (default 8), or is too slow, or the PC
   can't do it at all (a video longer than 5 s), ORBIT writes an **offer**. This happens only when Kaggle is on, set up, idle and has enough
   hours left (`ORBIT_KAGGLE_RESERVE_HOURS`, default 2, stay spare). Otherwise the job runs locally with a note, or is refused with the reason.
2. The offer shows the exact Python script that would go (your prompt is readable inside it), the estimated hours and why. Your click
   carries the hash of that script (`kaggle.upload`, approval-pure). A changed script needs a new click. Offers expire after a day.
3. `kaggle kernels push` creates a **private** script `<you>/orbit-burst-<id>` with a GPU, internet (for the model download) and a time limit.
4. ORBIT polls `kaggle kernels status` every minute, then `kaggle kernels output` and saves the result in VAULT like a local job.
   Then it deletes the script from Kaggle, so nothing of yours stays there.
5. The run's time (queue included, so it never counts too little) is added to the weekly count.

One Kaggle job at a time. Stop-all and **Cancel** delete ORBIT's own running script. The CLI has no cancel command, and deleting the script stops the run.
Only `orbit-burst-*` scripts are ever deleted. The time limit is twice the estimate plus 1 h, at most 12 h. Past it, ORBIT stops the job.

## What is never uploaded

Only the generated script goes. Video jobs send no files. A clip that starts from a VAULT picture stays on this PC.
`checkUpload` (kaggle-pure) also guards future kinds: only files from the job's own staging folder, never VAULT, LIFE or journal paths,
nothing that looks private by name (journal, life, vault, memory, token, kaggle.json, .env and so on), at most 4 files and 4 MB.
The prompt comes through CORE, whose egress rules already refuse private text in model-bound tools.

## Remote recipes

| Kind | Model | Licence | Pins |
|---|---|---|---|
| video (text to video, up to 30 s) | Wan 2.2 TI2V-5B, `Wan-AI/Wan2.2-TI2V-5B-Diffusers` @ `b8fff73` | Apache-2.0 | diffusers 0.43.0, transformers 5.23.0, accelerate 1.16.0 (Apache-2.0); ftfy 6.3.1, sentencepiece 0.2.3 (Apache-2.0); imageio 2.38.2, imageio-ffmpeg 0.8.1 (BSD-2) |

Long clips are made 5 s at a time. Each next part starts from the last frame of the one before, then they are joined.
fast = 832x480, 30 steps. best = 1280x704, 50 steps. 3D and other kinds have no remote recipe yet: `decide()` then keeps them local or refuses.

**Untested:** the script has never run on a real Kaggle T4 (bf16/fp16 choice, memory with CPU offload, speed). Estimates are
20 min setup + 20 min (fast) or 60 min (best) per 5 s part. Check the first real run's log at kaggle.com/code/&lt;you&gt;/orbit-burst-…/log.
The CLI calls are covered by tests with a fake CLI. A real account, Windows paths and the PowerShell setup were not run.

## Settings

`ORBIT_KAGGLE=0` turns it off. Also `ORBIT_KAGGLE_CLI`, `ORBIT_KAGGLE_USER`, `ORBIT_KAGGLE_LOCAL_MAX_MIN`, `ORBIT_KAGGLE_RESERVE_HOURS`,
`ORBIT_KAGGLE_WEEKLY_HOURS`, `ORBIT_LOCAL_VRAM_GB` (see `.env.example`).
