# Local brain (Ollama)

A small AI model that runs on this PC. ORBIT uses it:

- when Claude is unreachable, rate-limited or on hold: CORE chat and background summaries (no tools, marked "local brain");
- only if you turn it on (`ORBIT_LOCAL_PRIVATE=1`): LIFE → Journal → "Reflect on my last 7 days". The journal goes to this
  local model only, never to Claude, only when you click, and the answer is not saved.

## Set up (PowerShell, in the ORBIT folder)

    powershell -ExecutionPolicy Bypass -File tools\ollama\setup.ps1            # chat fallback only
    powershell -ExecutionPolicy Bypass -File tools\ollama\setup.ps1 -Private   # also journal reflections on this PC
    npm run app:rebuild

It installs Ollama (`winget install --id Ollama.Ollama`, no admin), pulls the model, prints a test reply in English and
Estonian and writes `ORBIT_LOCAL_LLM_MODEL` to `.env.local`. OPERATIONS → Local AI shows "Local brain: Ready".
If Ollama isn't running, ORBIT starts it hidden (`ollama serve`) when that page is opened.

## The model: `qwen3:8b`

Qwen3 8B, Q4_K_M (Ollama's default), ~5.2 GB download, about 6 GB of GPU memory with an 8k context: fits the RTX 5060
Laptop's 8 GB. Apache 2.0 license. Trained for 100+ languages; Qwen lists Estonian among them, but how good its Estonian
is hasn't been tested here: read the test reply. ORBIT turns its "thinking" off (`think: false`) for quick answers.

Other models: `-Model qwen3:4b` (~2.5 GB, faster, weaker), `-Model qwen3.5:9b` (newer; check it fits first),
`-Model gemma3:4b` (Gemma license). Any Ollama model name works.

## Settings (.env.local)

| Name | Meaning | Default |
|---|---|---|
| `ORBIT_LOCAL_LLM_MODEL` | Ollama model name; empty = local brain off (`ORBIT_LOCAL_MODEL` is the older name, still read) | empty |
| `ORBIT_LOCAL_LLM_URL` | Ollama address; must be on this PC (`127.0.0.1`/`localhost`), anything else is ignored | `http://127.0.0.1:11434` |
| `ORBIT_LOCAL_PRIVATE` | `1` = the local model may read the journal when you click Reflect | off |

Ollama unloads the model from the GPU after 5 idle minutes (its default), so it doesn't hold VRAM the Local AI tools need.
