# Local brain (Ollama)

A small AI model that runs on this PC. ORBIT uses it:

- when Claude is unreachable, rate-limited or on hold: CORE chat and background summaries (no tools, marked "local brain");
- reading files on this PC for VAULT intake (never a cloud model).

It never reads your journal or any other LIFE text. ORBIT's rule is that journal text goes to no model at all, not even a
local one. There used to be an opt-in "Reflect" button (`ORBIT_LOCAL_PRIVATE=1`) that did; it was removed because a setting
is not a guarantee, only a missing code path is. `ORBIT_LOCAL_PRIVATE` and `setup.ps1 -Private` are now ignored.

## Set up (PowerShell, in the ORBIT folder)

    powershell -ExecutionPolicy Bypass -File tools\ollama\setup.ps1
    npm run app:rebuild

It installs Ollama (`winget install --id Ollama.Ollama`, no admin), pulls the models (`qwen3.5:9b` and `qwen3.5:4b`), prints a test reply in English and
Estonian and writes `ORBIT_LOCAL_LLM_MODEL` to `.env.local`. OPERATIONS → Local AI shows "Local brain: Ready".
If Ollama isn't running, ORBIT starts it hidden (`ollama serve`) when that page is opened.

## The models: `qwen3.5:9b` and `qwen3.5:4b`

| Tag | Download | Notes |
|---|---|---|
| `qwen3.5:9b` (default) | 6.6 GB (Q4_K_M, 8.95B + vision encoder) | Apache-2.0; text and image input; tools, vision and thinking capabilities; 256K context. Fits the RTX 5060 Laptop's 8 GB with an 8k-32k context. |
| `qwen3.5:4b` (small) | 3.3 GB | Same family and license; used automatically, see below. |

(Checked on ollama.com/library/qwen3.5, 2026-11-20.) ORBIT sends plain text only, with no tools; the local brain has no vision path
yet (CORE's "look at my screen" still uses Claude). ORBIT turns "thinking" off (`think: false`, which it already did for every
`qwen3*` name, so `qwen3.5` is covered) for quick answers. Estonian is among Qwen's languages; how good it is hasn't been tested
here: read the setup test reply. Tip for long contexts: set `OLLAMA_KV_CACHE_TYPE=q8_0` and `OLLAMA_FLASH_ATTENTION=1` in Ollama's environment.

**Automatic smaller choice.** When `ORBIT_LOCAL_LLM_MODEL` is `qwen3.5:9b` and `qwen3.5:4b` is pulled, each local call uses the 4B
model while another job holds the shared GPU lease (pictures, 3D, video, music, NVENC render: `src/lib/gpu-lock.ts`) or while free
VRAM is below 7000 MiB (`nvidia-smi`, when present). The choice is made per call and cached for seconds, so the 9B comes back as
soon as the GPU is free. A configured `qwen3:8b` steps down to `qwen3:4b` the same way if that is pulled. Any other model is used as is.

**Old or missing models.** If the configured model isn't pulled, ORBIT answers with whatever chat model is installed
(`qwen3.5:9b`, `qwen3.5:4b`, `qwen3:8b`, `qwen3:4b`, then any other; never a cloud model or an embedding model), and OPERATIONS → Local AI
and the doctor show "Using another model" with the exact command, e.g. `Run: ollama pull qwen3.5:9b`. Existing setups that have
`ORBIT_LOCAL_LLM_MODEL=qwen3:8b` keep working unchanged; to upgrade run `ollama pull qwen3.5:9b` and set the variable (or re-run `setup.ps1`).

Other models: `-Model qwen3:8b` (the old default, ~5.2 GB), `-Model gemma3:4b` (Gemma license). Any Ollama model name works.

## Settings (.env.local)

| Name | Meaning | Default |
|---|---|---|
| `ORBIT_LOCAL_LLM_MODEL` | Ollama model name (setup writes `qwen3.5:9b`); empty = local brain off (`ORBIT_LOCAL_MODEL` is the older name, still read) | empty |
| `ORBIT_LOCAL_LLM_URL` | Ollama address; must be on this PC (`127.0.0.1`/`localhost`), anything else is ignored | `http://127.0.0.1:11434` |

Ollama unloads the model from the GPU after 5 idle minutes (its default), so it doesn't hold VRAM the Local AI tools need.
