# Roblox file tools (Rojo + Selene)

Used by ORBIT's GAME DEV -> Build -> Files and CORE's `roblox_export` / `roblox_lint`. Everything runs on your PC; nothing is uploaded or published.

| Tool | Version | What it does |
|---|---|---|
| Rokit | 1.2.0 | Installs and pins the tools below (replaces Aftman). |
| Rojo | 7.7.1 | Copies scripts between files and Roblox Studio. |
| Selene | 0.31.0 | Checks Luau code for mistakes. |
| Git | yours | Keeps every exported version, so each change is a reviewable diff. |

## Setup (once)

1. Install Git if you don't have it: `winget install Git.Git`.
2. Close Roblox Studio. From the ORBIT folder run:
   `powershell -ExecutionPolicy Bypass -File tools\roblox\setup.ps1`
3. Restart ORBIT and Studio. Studio's Plugins tab now has **Rojo**.

## Use

1. **Export**: in Studio, File -> Save to File As... (`.rbxl`). In ORBIT, GAME DEV -> Build -> Files, paste the file's path and press
   *Export scripts to files*. ORBIT runs `rojo syncback` into `Documents\RobloxProjects\<place name>` (set `ORBIT_ROBLOX_PROJECTS`
   to use another folder) with `default.project.json`, `selene.toml` and `.gitignore`, then makes a git commit.
   Exporting again commits only what changed; ORBIT refuses if the folder has changes you haven't committed.
   Exported: ReplicatedFirst, ReplicatedStorage, ServerScriptService, ServerStorage, StarterGui, StarterPack,
   StarterPlayerScripts, StarterCharacterScripts. **Not Workspace** (Rojo would take over every part); move scripts out of Workspace
   (e.g. into ServerScriptService) if you want them on disk.
2. **Check code**: pick the project, press *Check code*. Selene's issues are grouped by file with the line; "line N" opens VS Code there.
   Warnings are hints, not proof of a bug.
3. **Live sync**: *Start sync* runs `rojo serve` (127.0.0.1:34872). In Studio: Plugins -> Rojo -> Connect. Rojo lists the changes it
   wants to make; Accept only if they look right. Then edit scripts in the files and save: Studio updates at once. *Stop sync* (or
   Stop-all) stops it.

From a terminal in the project folder the same tools work: `rojo serve`, `selene src`, `git log -p`.
