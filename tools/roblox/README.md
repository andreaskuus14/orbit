# Roblox file tools (Rojo + Selene + StyLua)

Used by ORBIT's GAME DEV -> Build -> Files and CORE's `roblox_*` tools. Everything runs on your PC; nothing is uploaded or published.
Publishing to Roblox is always your own click in Studio (File -> Publish to Roblox).

| Tool | Version | Licence | What it does |
|---|---|---|---|
| Rokit | 1.2.0 | MIT | Installs and pins the tools below (replaces Aftman). |
| Rojo | 7.7.1 | MPL-2.0 | Copies scripts between files and Roblox Studio; its Studio plugin is installed too. |
| Selene | 0.31.0 | MPL-2.0 | Checks Luau code for mistakes. |
| StyLua | 2.6.0 | MPL-2.0 | Keeps Luau code tidy. |
| Git | yours | GPL-2.0 (used as a program) | Keeps every version, so each change is a diff and ORBIT's edits can be undone. |

## Setup (once)

1. Install Git if you don't have it: `winget install Git.Git`.
2. Close Roblox Studio. From the ORBIT folder run:
   `powershell -ExecutionPolicy Bypass -File tools\roblox\setup.ps1`
3. Restart ORBIT and Studio. Studio's Plugins tab now has **Rojo**.

## Use

1. **Connect project folder**: paste your game's folder path. ORBIT reads its `default.project.json`, or makes one (script services
   under `src\`, not Workspace), adds `selene.toml`, `stylua.toml`, `.gitignore` and `rokit.toml` only when missing (never overwrites),
   and starts a git history if there is none. Remembered in ORBIT's data folder (`rojo-folders.json`); *Forget folder* drops it.
   **Or export** a saved place (`.rbxl`): ORBIT runs `rojo syncback` into `Documents\RobloxProjects\<place name>`
   (`ORBIT_ROBLOX_PROJECTS` changes the folder) and commits it.
2. **Check code**: Selene mistakes and StyLua tidiness, in plain words, by file and line. *Format code* tidies everything (one commit).
3. **Live sync**: *Start sync* checks the code first. Selene errors or code that doesn't parse stop it (you can press *Start anyway*);
   hints and untidy code don't. Then ORBIT runs `rojo serve default.project.json --address 127.0.0.1 --port 34872` (this PC only,
   even if the project file asks for another address). In Studio: Plugins -> Rojo -> Connect, read the change list, Accept.
   *Stop sync* or Stop-all stops it.
4. **CORE edits**: CORE can list, read and write `.luau` files inside the project's folders. Each write is tidied by StyLua and
   checked by Selene in a temp folder first (a Selene error refuses it), then saved as a git commit `ORBIT edit: ...`. Your own
   unsaved changes are committed first as a snapshot. *Undo ORBIT's last change* (or CORE's `roblox_undo`) reverts ORBIT's newest
   edit with a new commit; your own commits are never touched. While live sync is on, Rojo puts each saved file into Studio at once.
5. **Back up scripts**: `rojo build` writes `backups\<name>-<time>.rbxl` (git-ignored). It holds only what the files hold (scripts),
   not parts or terrain: save the place in Studio for those.

From a terminal in the project folder the same tools work: `rojo serve`, `selene src`, `stylua --check src`, `git log -p`.
