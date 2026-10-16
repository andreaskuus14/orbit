# ORBIT wake word ("orbital wake up")

Say **"orbital wake up"** (or "orbit wake up", "hey orbit wake up", "orbit wake") and ORBIT opens even if it was closed:

1. A small hidden PowerShell listener hears the phrase.
2. If the ORBIT server isn't answering on http://localhost:3000, it runs `scripts\launch.ps1 -ServerOnly` hidden (production build, rebuilt if needed, with auto-restart; see [../README.md](../README.md)) and waits for it.
3. It opens ORBIT as a Chrome app window at `/?wake=1`. ORBIT opens CORE, CORE says a short hello, then the mic starts listening. Ask your question and CORE answers out loud.

If Chrome blocks the voice (it only allows speech without a click when Chrome wasn't already running), you get a big **Tap to talk** button instead.

## Privacy

- Uses the speech recognition built into Windows (System.Speech). It runs **fully offline**. No audio is recorded, stored or sent anywhere.
- It only reacts to the wake phrases. Windows also matches other speech to text inside the listener so it isn't mistaken for the phrase; that text is thrown away and never logged.
- The log (`%LOCALAPPDATA%\orbit-wake\wake.log`, max ~200 KB) only records start-up, the wake phrases it heard and their confidence, and errors.
- After ORBIT opens, the question you ask goes through ORBIT's normal voice input. In "Chrome recognition" mode Chrome sends that audio to Google to transcribe; in "Local only" mode it's transcribed by Whisper on this PC.

## Install / uninstall

From the ORBIT folder (`C:\Users\andre\Documents\orbit`):

```
npm run wake:install     # Startup-folder shortcut + start the listener now
npm run wake:uninstall   # remove the shortcut and stop the listener
npm run wake:run         # run it in this window to watch what it hears (Ctrl+C to stop)
```

No admin rights needed. The only things it creates are `ORBIT wake.lnk` in your Startup folder and the `%LOCALAPPDATA%\orbit-wake` folder.

Options (for `wake:run`, or edit the shortcut): `-MinConfidence 0.7` (raise it if it triggers by mistake, lower it if it misses you), `-CooldownSeconds 10`.

## Troubleshooting

Check `%LOCALAPPDATA%\orbit-wake\wake.log` first.

- **"no microphone available"** (exit code 4): plug in a mic and set it as the default in Windows Sound settings. Also turn on **Settings > Privacy & security > Microphone > "Let desktop apps access your microphone"**.
- **"no speech recognizer installed"** (exit code 3), or it never hears you: add the English speech pack in **Settings > Time & language > Language & region** (add English (United States) and include *Speech recognition*), or **Settings > Time & language > Speech**.
- **"audio input stopped"** (exit code 5): the mic was unplugged. Sign out and back in, or run `npm run wake:install` again.
- **Triggers by mistake / misses you**: watch the confidence values in `npm run wake:run` and adjust `-MinConfidence`.
- **ORBIT opens but CORE doesn't speak**: click **Tap to talk**. To get the voice without a click, close Chrome completely before saying the phrase. Check "Speak answers" is on in ORBIT's voice settings.
- **ORBIT opens on the login page**: sign in to ORBIT in Chrome once; the greeting runs on the next wake.
- **Server doesn't start**: see `orbit-server.log` in the ORBIT folder; make sure `npm run app:start` works by hand (see `scripts\README.md`).
