r"""PC actions for ORBIT's local helper (orbit_voice.py /act and /undo). ORBIT decides WHAT may run (src/lib/pc-policy-pure.ts:
levels 1-3, level 3 only after the owner's OK); this file re-checks the folder rule on its own and does the work with Windows
tools only (PowerShell, git, npm, winget). No shell strings: every command is an argument list.

Return value: {"ok": bool, "text": str, "undo"?: dict} — undo is the before-state for level-2 actions.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


def parse_folders(raw: str) -> list[Path]:
    out = []
    for x in (raw or "").split(";"):
        x = x.strip()
        if not x:
            continue
        p = Path(x)
        low = str(p).replace("\\", "/").lower()
        if not p.is_absolute() or "/windows" in low[:12] or "program files" in low or "programdata" in low or "/appdata" in low or len(p.parts) < 2:
            continue
        out.append(p)
    return out


def inside(p: str, folders: list[Path]) -> Path:
    """The real path, if it is one of the connected folders or inside one (symlinks resolved); else raises."""
    real = Path(os.path.realpath(p))
    for f in folders:
        r = Path(os.path.realpath(f))
        if real == r or r in real.parents:
            return real
    raise PermissionError("not inside a connected folder")


def run(cmd: list[str], cwd: str | None = None, timeout: int = 60) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, creationflags=NO_WINDOW, encoding="utf-8", errors="replace")


def ps(script: str, timeout: int = 60) -> subprocess.CompletedProcess:
    return run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], timeout=timeout)


def ps_quote(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


VK = {"play_pause": 0xB3, "next": 0xB0, "previous": 0xB1, "volume_up": 0xAF, "volume_down": 0xAE, "mute": 0xAD}


def tail(s: str, n: int = 4000) -> str:
    return s if len(s) <= n else "…" + s[-n:]


def act(action: str, a: dict, folders: list[Path]) -> dict:
    s = lambda k: str(a.get(k) or "")
    if action == "open_app":
        target = s("target")
        if not target or any(c in target for c in "&|<>^\"\n"):
            return {"ok": False, "text": "bad app target"}
        subprocess.Popen(["cmd", "/c", "start", "", target], creationflags=NO_WINDOW)
        return {"ok": True, "text": ""}
    if action == "focus_app":
        name = s("app").removesuffix(".exe")
        r = ps(f"$p = Get-Process -Name {ps_quote(name)} -ErrorAction SilentlyContinue | Where-Object {{ $_.MainWindowHandle -ne 0 }} | Select-Object -First 1;"
               "if (-not $p) { exit 3 }; (New-Object -ComObject WScript.Shell).AppActivate($p.Id) | Out-Null")
        return {"ok": r.returncode == 0, "text": "" if r.returncode == 0 else "that app isn't open"}
    if action == "read_file":
        p = inside(s("path"), folders)
        if not p.is_file():
            return {"ok": False, "text": "not a file"}
        data = p.read_bytes()[:200_000]
        return {"ok": True, "text": data.decode("utf-8", errors="replace")}
    if action == "list_folder":
        p = inside(s("path"), folders)
        if not p.is_dir():
            return {"ok": False, "text": "not a folder"}
        items = sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))[:300]
        return {"ok": True, "text": "\n".join(f"{'[dir] ' if x.is_dir() else ''}{x.name}" for x in items)}
    if action == "run_task":
        p = inside(s("folder"), folders)
        task = s("task")
        pkg = p / "package.json"
        scripts = json.loads(pkg.read_text(encoding="utf-8")).get("scripts", {}) if pkg.is_file() else {}
        if task not in scripts:
            return {"ok": False, "text": f"no npm script '{task}' in {p}"}
        r = run(["npm.cmd" if sys.platform == "win32" else "npm", "run", task], cwd=str(p), timeout=600)
        return {"ok": r.returncode == 0, "text": f"exit {r.returncode}\n{tail(r.stdout + r.stderr)}"}
    if action == "media_key":
        vk = VK.get(s("key"))
        if vk is None or sys.platform != "win32":
            return {"ok": False, "text": "media keys need Windows"}
        import ctypes
        u = ctypes.windll.user32
        u.keybd_event(vk, 0, 0, 0)
        u.keybd_event(vk, 0, 2, 0)
        return {"ok": True, "text": ""}
    if action in ("move_file", "rename_file"):
        src = inside(s("from"), folders)
        dst = Path(os.path.realpath(s("to")))
        inside(str(dst.parent), folders)
        if not src.exists():
            return {"ok": False, "text": "source not found"}
        if dst.exists():
            return {"ok": False, "text": "something already has that name; nothing was moved"}
        shutil.move(str(src), str(dst))
        return {"ok": True, "text": "", "undo": {"from": str(src), "to": str(dst)}}
    if action == "code_edit":
        repo = inside(s("repo"), folders)
        f = Path(os.path.realpath(repo / s("file")))
        if repo not in f.parents or not f.is_file():
            return {"ok": False, "text": "file not in the repository"}
        if run(["git", "status", "--porcelain"], cwd=str(repo)).stdout.strip():
            return {"ok": False, "text": "the repository has uncommitted changes; commit or stash them first"}
        text = f.read_text(encoding="utf-8")
        find, repl = str(a.get("find") or ""), str(a.get("replace") or "")
        if text.count(find) != 1:
            return {"ok": False, "text": f"the text to change occurs {text.count(find)} times (needs exactly once)"}
        prev = run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=str(repo)).stdout.strip()
        branch = time.strftime("orbit/voice-edit-%Y%m%d-%H%M%S")
        r = run(["git", "checkout", "-b", branch], cwd=str(repo))
        if r.returncode:
            return {"ok": False, "text": tail(r.stderr, 400)}
        f.write_text(text.replace(find, repl), encoding="utf-8")
        rel = str(f.relative_to(repo))
        run(["git", "add", "--", rel], cwd=str(repo))
        r = run(["git", "commit", "-m", f"ORBIT voice edit: {rel}"], cwd=str(repo))
        if r.returncode:
            run(["git", "checkout", "--", rel], cwd=str(repo)); run(["git", "checkout", prev], cwd=str(repo))
            return {"ok": False, "text": tail(r.stderr, 400)}
        return {"ok": True, "text": f"committed on branch {branch} (your branch {prev} is untouched)", "undo": {"repo": str(repo), "branch": branch, "prev": prev}}
    if action == "delete_file":
        p = inside(s("path"), folders)
        if any(Path(os.path.realpath(x)) == p for x in folders):
            return {"ok": False, "text": "never a connected folder itself"}
        kind = "DeleteDirectory" if p.is_dir() else "DeleteFile"
        r = ps(f"Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::{kind}({ps_quote(str(p))}, 'OnlyErrorDialogs', 'SendToRecycleBin')")
        return {"ok": r.returncode == 0, "text": "in the Recycle Bin" if r.returncode == 0 else tail(r.stderr, 400)}
    if action == "install_app":
        pid = s("id")
        r = run(["winget", "install", "--id", pid, "--exact", "--silent", "--accept-package-agreements", "--accept-source-agreements"], timeout=1800)
        return {"ok": r.returncode == 0, "text": tail(r.stdout + r.stderr, 1500)}
    if action == "system_setting" and s("setting") == "dark_mode":
        light = 0 if s("value") == "on" else 1
        key = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"
        r = ps(f"Set-ItemProperty -Path '{key}' -Name AppsUseLightTheme -Value {light}; Set-ItemProperty -Path '{key}' -Name SystemUsesLightTheme -Value {light}")
        return {"ok": r.returncode == 0, "text": ""}
    return {"ok": False, "text": f"unknown action {action}"}


def undo(action: str, u: dict, folders: list[Path]) -> dict:
    if action in ("move_file", "rename_file"):
        src, dst = Path(u.get("from", "")), Path(u.get("to", ""))
        inside(str(dst), folders); inside(str(src.parent), folders)
        if src.exists():
            return {"ok": False, "text": "the original place is taken again"}
        if not dst.exists():
            return {"ok": False, "text": "the file isn't where ORBIT put it anymore"}
        shutil.move(str(dst), str(src))
        return {"ok": True, "text": ""}
    if action == "code_edit":
        repo = inside(u.get("repo", ""), folders)
        r = run(["git", "checkout", str(u.get("prev") or "")], cwd=str(repo))
        return {"ok": r.returncode == 0, "text": f"back on {u.get('prev')}; branch {u.get('branch')} kept for review" if r.returncode == 0 else tail(r.stderr, 400)}
    return {"ok": False, "text": "no undo for that"}
