# ORBIT code sandbox harness (src/lib/sandbox.ts starts it; rules in src/lib/sandbox-pure.ts).
#   python -I run.py <limits.json>      (cwd = the run's own temp folder, with main.py and the copied-in files)
# Before the owner's code runs, this process locks itself down; nothing below can be undone from inside:
#   1. limits: Windows Job Object (memory cap, one process only, CPU time) / POSIX rlimits (address space, CPU, no new processes)
#   2. a wall-clock watchdog that ends the process at the time limit
#   3. an audit hook (PEP 578, cannot be removed): no network, no new processes, no ctypes, no registry, files opened for
#      writing only inside the run folder, files read only from the run folder and Python's own install
# Then main.py runs. Open matplotlib figures that were not saved are written as figure-N.png at the end.
import json
import os
import sys
import threading

LIMITS = json.load(open(sys.argv[1], encoding="utf-8"))
WORK = os.path.realpath(os.getcwd())
MEM = int(LIMITS.get("memoryMb", 1024)) * 1024 * 1024
CPU = int(LIMITS.get("cpuSec", 60))
WALL = float(LIMITS.get("wallSec", 60))
WIN = os.name == "nt"


def _limit_windows():
    import ctypes
    from ctypes import wintypes

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)

    class BASIC(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64), ("LimitFlags", wintypes.DWORD),
                    ("MinimumWorkingSetSize", ctypes.c_size_t), ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                    ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

    class IOC(ctypes.Structure):
        _fields_ = [(n, ctypes.c_uint64) for n in ("r", "w", "o", "rb", "wb", "ob")]

    class EXT(ctypes.Structure):
        _fields_ = [("Basic", BASIC), ("Io", IOC), ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                    ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

    k32.CreateJobObjectW.restype = wintypes.HANDLE
    k32.GetCurrentProcess.restype = wintypes.HANDLE
    # without argtypes ctypes passes handles as 32-bit ints; the pseudo-handle from GetCurrentProcess (-1) then overflows
    k32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    k32.SetInformationJobObject.restype = wintypes.BOOL
    k32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    k32.AssignProcessToJobObject.restype = wintypes.BOOL
    job = k32.CreateJobObjectW(None, None)
    if not job:
        raise OSError("CreateJobObject failed")
    info = EXT()
    # PROCESS_TIME 0x2 | ACTIVE_PROCESS 0x8 | PROCESS_MEMORY 0x100 | DIE_ON_UNHANDLED_EXCEPTION 0x400
    info.Basic.LimitFlags = 0x2 | 0x8 | 0x100 | 0x400
    info.Basic.PerProcessUserTimeLimit = CPU * 10_000_000  # 100 ns units
    info.Basic.ActiveProcessLimit = 1
    info.ProcessMemoryLimit = MEM
    if not k32.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)):  # JobObjectExtendedLimitInformation
        raise OSError("SetInformationJobObject failed: %d" % ctypes.get_last_error())
    if not k32.AssignProcessToJobObject(job, k32.GetCurrentProcess()):
        raise OSError("AssignProcessToJobObject failed: %d" % ctypes.get_last_error())
    # The handle stays open for the life of this process, so the job and its limits do too.


def _limit_posix():
    import resource
    for name, value in (("RLIMIT_AS", MEM), ("RLIMIT_CPU", CPU), ("RLIMIT_NPROC", 0), ("RLIMIT_FSIZE", int(LIMITS.get("outMb", 50)) * 1024 * 1024), ("RLIMIT_CORE", 0)):
        r = getattr(resource, name, None)
        if r is None:
            continue
        try:
            resource.setrlimit(r, (value, value))
        except (ValueError, OSError):
            # RLIMIT_NPROC counts all of this user's processes on some systems; the audit hook still blocks new processes.
            pass


try:
    _limit_windows() if WIN else _limit_posix()
    LIMITED = True
except Exception as e:  # noqa: BLE001
    LIMITED = False
    sys.stderr.write("[sandbox] could not set the memory/CPU limits (%s); the time limit and the blocks still apply\n" % e)


def _watchdog():
    sys.stderr.write("\n[sandbox] stopped: the %d-second time limit was reached\n" % WALL)
    sys.stderr.flush()
    os._exit(124)


_t = threading.Timer(WALL, _watchdog)
_t.daemon = True
_t.start()

# ---- the audit hook ----
_norm = os.path.normcase
READ_ROOTS = [_norm(os.path.realpath(p)) for p in {WORK, sys.prefix, sys.base_prefix, sys.exec_prefix, os.path.dirname(os.__file__), os.path.dirname(os.path.realpath(sys.executable))} if p]
READ_ROOTS += [_norm(p) for p in LIMITS.get("readRoots", [])]
if not WIN:
    READ_ROOTS += ["/usr/share/zoneinfo", "/usr/share/fonts", "/proc/self", "/sys/devices/system/cpu", "/dev/null", "/dev/urandom", "/etc/localtime"]
else:
    READ_ROOTS += [_norm(os.path.join(os.environ.get("SYSTEMROOT", r"C:\Windows"), "Fonts"))]
WRITE_ROOTS = [_norm(WORK)]

BLOCK_PREFIX = ("socket.", "subprocess.", "os.system", "os.exec", "os.spawn", "os.posix_spawn", "os.fork", "os.forkpty", "os.startfile",
                "os.kill", "os.killpg", "ctypes.", "winreg.", "_winapi.", "msvcrt.", "pty.", "webbrowser.", "urllib.Request", "http.client.",
                "ftplib.", "smtplib.", "imaplib.", "poplib.", "nntplib.", "telnetlib.", "sys.remote_exec", "sqlite3.load_extension", "_posixsubprocess")
BLOCK_IMPORT = {"socket", "_socket", "ssl", "_ssl", "ctypes", "_ctypes", "subprocess", "_posixsubprocess", "multiprocessing", "_multiprocessing",
                "winreg", "_winapi", "asyncio.windows_utils", "pty", "webbrowser", "urllib.request", "http.client", "ftplib", "smtplib", "requests", "httpx", "aiohttp", "urllib3"}
WRITE_EVENTS = {"os.remove", "os.rename", "os.rmdir", "os.mkdir", "os.chmod", "os.chown", "os.link", "os.symlink", "os.truncate", "os.utime", "shutil.rmtree", "shutil.move", "shutil.copyfile", "os.removexattr", "os.setxattr"}


def _inside(path, roots):
    try:
        p = _norm(os.path.realpath(os.fspath(path)))
    except Exception:  # noqa: BLE001
        return False
    return any(p == r or p.startswith(r.rstrip("\\/") + os.sep) for r in roots)


class Blocked(PermissionError):
    pass


_ready = False


def _hook(event, args):
    if not _ready:
        return
    if event == "import":
        name = args[0] or ""
        if name in BLOCK_IMPORT or name.split(".")[0] in {"socket", "ssl", "ctypes", "subprocess", "multiprocessing", "requests", "httpx", "aiohttp", "urllib3"}:
            raise Blocked("the sandbox has no network and can't start programs: '%s' is blocked" % name)
        return
    if event.startswith(BLOCK_PREFIX):
        raise Blocked("blocked in the sandbox: %s (no network, no other programs)" % event)
    if event == "open":
        path, mode, flags = args[0], args[1], args[2]
        if isinstance(path, int):
            return
        writing = (mode and any(c in str(mode) for c in "wax+")) or (isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | os.O_TRUNC))
        if writing and not _inside(path, WRITE_ROOTS):
            raise Blocked("the sandbox can only write files in its own folder, not %s" % path)
        if not writing and not _inside(path, READ_ROOTS):
            raise Blocked("the sandbox can only read its own files, not %s" % path)
        return
    if event in WRITE_EVENTS:
        for a in args[:2]:
            if isinstance(a, (str, bytes, os.PathLike)) and not _inside(a, WRITE_ROOTS):
                raise Blocked("the sandbox can only change files in its own folder")
        return
    if event in ("os.listdir", "os.scandir") and args and args[0] not in (None, ".") and isinstance(args[0], (str, bytes, os.PathLike)):
        if not _inside(args[0], READ_ROOTS):
            raise Blocked("the sandbox can only list its own folder")


# Libraries that are fine but would trip the hook on import: load them before the hook turns on (numpy's own ctypes use etc.).
os.environ.setdefault("MPLCONFIGDIR", os.path.join(WORK, ".mpl"))
os.environ.setdefault("MPLBACKEND", "Agg")
PRELOAD = [m for m in LIMITS.get("preload", ["numpy", "pandas", "matplotlib", "matplotlib.pyplot"])]
for m in PRELOAD:
    try:
        __import__(m)
    except Exception:  # noqa: BLE001
        pass

sys.addaudithook(_hook)
_ready = True
# Modules already loaded (matplotlib keeps subprocess for its tools) stay usable only through audited calls: socket.connect,
# subprocess.Popen, ctypes.dlopen/call_function etc. all raise events the hook refuses. Fresh imports of them are refused outright.

code_path = os.path.join(WORK, "main.py")
src = open(code_path, encoding="utf-8-sig").read()  # -sig: a BOM from Windows editors is dropped
g = {"__name__": "__main__", "__file__": code_path, "__builtins__": __builtins__}
status = 0
try:
    exec(compile(src, "main.py", "exec"), g)
except SystemExit as e:
    status = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
except BaseException:  # noqa: BLE001
    import traceback
    tb = traceback.format_exc()
    sys.stderr.write(tb.replace(WORK + os.sep, ""))
    status = 1
finally:
    try:
        plt = sys.modules.get("matplotlib.pyplot")
        if plt is not None:
            saved = {f for f in os.listdir(WORK) if f.lower().endswith((".png", ".svg"))}
            if not saved:
                for i, num in enumerate(plt.get_fignums(), 1):
                    plt.figure(num).savefig(os.path.join(WORK, "figure-%d.png" % i), dpi=120, bbox_inches="tight")
    except Exception as e:  # noqa: BLE001
        sys.stderr.write("[sandbox] could not save the chart: %s\n" % e)
    sys.stdout.flush()
    sys.stderr.flush()
os._exit(status)
