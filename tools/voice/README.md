# ORBIT desk listener + PC helper (JARVIS phase 1)

"Hey Orbit" in any window, with the ORBIT tab closed or in the background. Free and local.

```
powershell -ExecutionPolicy Bypass -File tools\voice\setup.ps1     # once (~60 MB), adds a Startup shortcut
powershell -ExecutionPolicy Bypass -File tools\voice\start.ps1     # start now (or sign out and in)
```
Then ORBIT → Voice settings → **Background "Hey Orbit"**. The orb (bottom-right) shows grey = off, cyan = listening,
amber = thinking, violet = speaking, red = an action waits for your click (click the orb).

## How it works
mic → **Silero VAD** (cuts utterances) → ORBIT `/api/voice/desk` on loopback → ORBIT's **Parakeet** transcribes and looks for
"Hey Orbit" / "Orbit, …" (anything else is dropped right there, never stored or logged) → CORE (call engine, voice approvals
off) → **Kokoro** speech → played here. Talk over ORBIT to stop it (barge-in; headphones work best: there is no echo
cancellation). After an answer you have 8 s for a follow-up without the wake word. "Orbit, go to sleep" ends the talk.

CORE gets the active app + window title with every question; "fix this", "that error", "what's on my screen" also send one
screenshot (memory only). **Never** for ORBIT's LIFE page, password managers or banking sites (checked here and in ORBIT).
Optional peripheral mode (off by default): app + title every N s, kept in memory, so ORBIT can offer "You have a Luau error open".

PC actions (`pc_act`, rules in `src/lib/pc-policy-pure.ts`): level 1 now (open/focus apps, read files, npm test/build/lint/render,
media keys), level 2 with Undo in OPERATIONS → Activity (move/rename files, code edits committed on an `orbit/voice-edit-*`
branch), level 3 after your OK each time (delete to Recycle Bin, winget install, dark mode). Sends, posts, spends and logins
are never PC actions. Files only inside `ORBIT_PC_FOLDERS`.

Proactive lines (clip batch ready, a lead replied, GPU free with queued jobs) only when you're at the PC (keyboard/mouse in the
last 5 min) and never 23:00–08:00, in a call, focus block or under Stop-all; at most 6 a day, 10 min apart.

## Models
| Model | License | Where |
|---|---|---|
| Silero VAD v5.1.2 | MIT | `models/silero_vad.onnx` (from the PyPI wheel, hash-pinned) |
| Parakeet TDT 0.6B v3 (int8, sherpa-onnx) | CC-BY-4.0 | ORBIT's existing voice model |
| Kokoro 82M | Apache-2.0 | ORBIT's existing call voice |

Rejected: openWakeWord's pre-trained wake models (CC BY-NC-SA 4.0, non-commercial) and sherpa-onnx's English KWS model
(trained on GigaSpeech, whose terms are non-commercial research).

## Files / state
`%LOCALAPPDATA%\orbit\voice\`: `token` (shared secret), `helper.json` (helper port), `settings.json`, `pings.json`,
`pc-undo.json`, `voice.log` (states only; never transcripts or titles). Tests: `python -m unittest discover -s tools\voice\tests`.
