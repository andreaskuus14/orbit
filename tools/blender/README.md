# Blender + Bonsai for ORBIT

CORE can build and inspect 3D models in your own Blender through the **blender-mcp** plugin
(an MCP server, see Profile → Plugins). GAME DEV → Text to 3D → **Make in Blender** and ARCH → **Open in Blender / Bonsai** start it.

## Set up (once)

```powershell
powershell -ExecutionPolicy Bypass -File tools\blender\setup.ps1
```

What it does, step by step:

1. **Blender LTS** with winget (`BlenderFoundation.Blender.LTS.5.2`, falls back to `…LTS.4.5`). Skipped if Blender is already in Program Files.
2. **uv** with winget (`astral-sh.uv`): it installs small Python programs in their own sandbox.
3. **blender-mcp** with `uv tool install blender-mcp`: the program ORBIT talks to. It passes commands to Blender on port 9876 (this PC only).
   Sets `DISABLE_TELEMETRY=true` for your user: with blender-mcp's telemetry on, its terms license your prompts, code and screenshots to the maintainer.
4. **The BlenderMCP add-on** (`addon.py` from github.com/ahujasid/blender-mcp, the file its README tells you to install), installed and enabled in Blender.
5. **Bonsai** (BIM / IFC) from extensions.blender.org. If the command line install fails it tells you the 1-minute manual way.
6. Adds **blender** to ORBIT's plugin list (`%LOCALAPPDATA%\orbit\plugins.json`, or `ORBIT_DATA_DIR`). Never in git.

## Every time

1. Open Blender → in the 3D view press **N** → **BlenderMCP** tab → leave Poly Haven, Hyper3D, Sketchfab and Hunyuan3D **unchecked** → **Connect to MCP server**.
2. First time only: ORBIT → Profile → Plugins → blender → **Test connection**.
3. Ask CORE, or use the Make in Blender / Open in Blender buttons.

## Safety defaults

| Tool | Setting | Why |
|---|---|---|
| get_scene_info, get_object_info, get_viewport_screenshot | auto | read your open scene |
| execute_blender_code | **ask** | runs any Python inside Blender (it can also touch files and the network). CORE only queues the exact code; you read it in Profile → Plugins and click Run. Save your .blend first. |
| Poly Haven, Sketchfab, Hyper3D, Hunyuan3D tools | **off** | download from or generate on the internet; Hyper3D/Hunyuan can spend credits |

You can change each tool in Profile → Plugins. Setting execute_blender_code to auto lets CORE run code without asking: only do that while you watch.
Even on auto, code CORE wrote after reading a web page or an attached file is queued for your click. Stop-all stops plugin calls.

## Roblox import

Make in Blender exports `<name>.fbx` and `<name>.glb` into VAULT. In Roblox Studio: Home → **Import 3D** → pick the file → check scale and anchoring in the preview → Import.

Not tested on Windows yet (written in a cloud box). If a step fails, the message says what to do by hand.
