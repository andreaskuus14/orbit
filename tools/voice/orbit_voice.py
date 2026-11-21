r"""ORBIT desk listener + local helper (JARVIS phase 1). Runs in the background on the owner's Windows PC.

Mic (16 kHz mono) -> Silero VAD (MIT) cuts utterances -> ORBIT /api/voice/desk on loopback (Parakeet in ORBIT finds
"Hey Orbit"; utterances without it are dropped there, never stored) -> CORE -> Kokoro speech back -> played here.
Talking over ORBIT stops playback (barge-in). A small always-on-top orb shows off / listening / thinking / speaking and
holds Allow/Deny for level-3 PC actions.

The same process is ORBIT's local helper on 127.0.0.1:<random port> (port in <ORBIT data dir>/voice/helper.json):
GET /window (active app + title), POST /screenshot (one JPEG, refused for private windows), POST /act and /undo (PC actions,
pc_actions.py). Every request needs the shared token from <ORBIT data dir>/voice/token.

Audio is never written to disk. Run: tools\voice\start.ps1 (setup.ps1 once first). ORBIT_WAKE=0 in .env.local turns it off.
"""
from __future__ import annotations

import base64
import hmac
import http.client
import io
import json
import os
import queue
import sys
import threading
import time
import unicodedata
import urllib.parse
import wave
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
RATE = 16000
BLOCK = 512  # Silero VAD v5 frame at 16 kHz (32 ms)
FRAME_MS = BLOCK * 1000 // RATE

# BEGIN PRIVATE_WINDOW (mirrored from src/lib/jarvis-pure.ts; tests/jarvis.test.ts checks they match)
PRIVATE_WINDOW = {"apps": ["1password", "bitwarden", "keepass", "keepassxc", "lastpass", "dashlane", "nordpass", "enpass", "proton pass", "roboform", "keeper"], "titles": ["private · orbit", "1password", "bitwarden", "keepass", "lastpass", "dashlane", "nordpass", "proton pass", "password manager", "passwords", "online banking", "internet bank", "internetipank", "netbank", "swedbank", "seb", "lhv", "luminor", "coop pank", "revolut", "wise.com", "paypal", "n26", "monzo", "bank of", "credit union"]}
# END PRIVATE_WINDOW


def _low(s: str) -> str:
    return unicodedata.normalize("NFKC", s or "").lower()


def private_window(app: str, title: str) -> bool:
    """Same rule as jarvis-pure privateWindow: nothing about this window may be captured or sent."""
    a = _low(app)
    if a.endswith(".exe"):
        a = a[:-4]
    t = _low(title)
    if any(a == x or a.startswith(x) for x in PRIVATE_WINDOW["apps"]):
        return True
    for needle in PRIVATE_WINDOW["titles"]:
        i = t.find(needle)
        while i >= 0:
            before = t[i - 1] if i > 0 else " "
            after = t[i + len(needle)] if i + len(needle) < len(t) else " "
            if not before.isalnum() and not after.isalnum():
                return True
            i = t.find(needle, i + 1)
    return False


def data_dir() -> Path:
    d = os.environ.get("ORBIT_DATA_DIR", "").strip()
    if d:
        return Path(d)
    if os.environ.get("LOCALAPPDATA"):
        return Path(os.environ["LOCALAPPDATA"]) / "orbit"
    return Path.home() / ".orbit"


def read_env_local() -> dict[str, str]:
    """ORBIT's .env.local (KEY=VALUE lines): ORBIT_WAKE, ORBIT_PC_FOLDERS, ORBIT_URL."""
    out: dict[str, str] = {}
    p = ROOT / ".env.local"
    try:
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return out


# ---- Pure pieces (tests/test_voice.py) ------------------------------------------------------------------------------------

class Segmenter:
    """VAD probabilities -> whole utterances. Keeps a short pre-roll so the first syllable ("Hey") isn't cut."""

    def __init__(self, start_p=0.5, end_p=0.35, end_ms=700, min_speech_ms=400, preroll_ms=400, max_s=8.0):
        self.start_p, self.end_p, self.end_ms, self.min_speech_ms, self.max_s = start_p, end_p, end_ms, min_speech_ms, max_s
        self.pre: deque = deque(maxlen=max(1, preroll_ms // FRAME_MS))
        self.reset()

    def reset(self):
        self.active = False
        self.frames: list = []
        self.speech_ms = 0
        self.silence_ms = 0
        self.pre.clear()

    def push(self, frame: np.ndarray, p: float):
        if not self.active:
            if p >= self.start_p:
                self.active = True
                self.frames = list(self.pre) + [frame]
                self.speech_ms, self.silence_ms = FRAME_MS, 0
            else:
                self.pre.append(frame)
            return None
        self.frames.append(frame)
        if p >= self.end_p:
            self.speech_ms += FRAME_MS
            self.silence_ms = 0
        else:
            self.silence_ms += FRAME_MS
        if self.silence_ms >= self.end_ms or len(self.frames) * FRAME_MS >= self.max_s * 1000:
            audio = np.concatenate(self.frames) if self.speech_ms >= self.min_speech_ms else None
            self.reset()
            return audio
        return None


class Barge:
    """Port of src/lib/barge-pure.ts: the owner's voice clearly above ORBIT's own echo for 200 ms stops ORBIT."""
    BARGE_MS, WARMUP_MS, RATIO, MIN_VOICE = 200, 150, 2.0, 0.015

    def __init__(self):
        self.echo, self.play_ms, self.louder_ms = 0.0, 0, 0

    def step(self, level: float, frame_ms: int, talking: bool, voice: bool = True) -> bool:
        if not talking:
            self.echo, self.play_ms, self.louder_ms = 0.0, 0, 0
            return False
        louder = voice and self.play_ms >= self.WARMUP_MS and level > max(self.MIN_VOICE, self.echo * self.RATIO)
        self.louder_ms = self.louder_ms + frame_ms if louder else 0
        if not louder:
            self.echo = self.echo * 0.95 + level * 0.05 if self.echo else level
        self.play_ms += frame_ms
        return self.louder_ms >= self.BARGE_MS


def wav_bytes(x: np.ndarray, rate: int = RATE) -> bytes:
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return b.getvalue()


def read_wav(data: bytes) -> tuple[np.ndarray, int]:
    with wave.open(io.BytesIO(data), "rb") as w:
        rate, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if width != 2:
        raise ValueError("16-bit WAV expected")
    x = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    return x, rate


class Vad:
    """Silero VAD v5 (MIT) through onnxruntime on the CPU: one 512-sample frame -> speech probability."""

    def __init__(self, model: Path):
        import onnxruntime as ort
        o = ort.SessionOptions()
        o.intra_op_num_threads, o.inter_op_num_threads = 1, 1
        self.sess = ort.InferenceSession(str(model), o, providers=["CPUExecutionProvider"])
        self.reset()

    def reset(self):
        self.state = np.zeros((2, 1, 128), dtype=np.float32)
        self.ctx = np.zeros(64, dtype=np.float32)

    def __call__(self, x: np.ndarray) -> float:
        inp = np.concatenate([self.ctx, x.astype(np.float32)])[None, :]
        out, self.state = self.sess.run(None, {"input": inp, "state": self.state, "sr": np.array(RATE, dtype=np.int64)})
        self.ctx = x[-64:].astype(np.float32)
        return float(out[0, 0])


def utterances(vad: Vad, audio: np.ndarray, **seg) -> list[np.ndarray]:
    """Offline: a whole recording -> the utterances the live loop would send (tests and --file)."""
    s, out = Segmenter(**seg), []
    for i in range(0, len(audio) - BLOCK + 1, BLOCK):
        f = audio[i:i + BLOCK]
        u = s.push(f, vad(f))
        if u is not None:
            out.append(u)
    for _ in range(int(2000 / FRAME_MS)):  # trailing silence closes the last one
        u = s.push(np.zeros(BLOCK, np.float32), 0.0)
        if u is not None:
            out.append(u)
            break
    return out


# ---- Windows bits ------------------------------------------------------------------------------------------------------------

def active_window() -> dict:
    if sys.platform != "win32":
        return {"app": "", "title": ""}
    import ctypes
    from ctypes import wintypes
    u, k = ctypes.windll.user32, ctypes.windll.kernel32
    hwnd = u.GetForegroundWindow()
    n = u.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 1)
    u.GetWindowTextW(hwnd, buf, n + 1)
    pid = wintypes.DWORD()
    u.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    app = ""
    h = k.OpenProcess(0x1000, False, pid.value)  # PROCESS_QUERY_LIMITED_INFORMATION
    if h:
        size = wintypes.DWORD(1024)
        pbuf = ctypes.create_unicode_buffer(1024)
        if k.QueryFullProcessImageNameW(h, 0, pbuf, ctypes.byref(size)):
            app = os.path.basename(pbuf.value)
        k.CloseHandle(h)
    return {"app": app, "title": buf.value}


def idle_ms() -> int | None:
    """Time since his last keyboard/mouse input (presence for proactive pings)."""
    if sys.platform != "win32":
        return None
    import ctypes

    class LASTINPUTINFO(ctypes.Structure):
        _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]
    li = LASTINPUTINFO()
    li.cbSize = ctypes.sizeof(li)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(li)):
        return None
    return max(0, (ctypes.windll.kernel32.GetTickCount() - li.dwTime) & 0xFFFFFFFF)


def screenshot_jpeg() -> bytes | None:
    w = active_window()
    if private_window(w["app"], w["title"]):
        return None
    from PIL import ImageGrab
    img = ImageGrab.grab()
    w2 = active_window()  # the window may have changed while grabbing
    if private_window(w2["app"], w2["title"]):
        return None
    img.thumbnail((1568, 1568))
    b = io.BytesIO()
    img.convert("RGB").save(b, "JPEG", quality=85)
    return b.getvalue()


# ---- The app ---------------------------------------------------------------------------------------------------------------

class App:
    FOLLOW_S = 8.0  # after an answer, a follow-up needs no wake word for this long
    ARMED_S = 12.0  # after a bare "Hey Orbit"

    def __init__(self):
        env = {**read_env_local(), **os.environ}
        u = urllib.parse.urlparse(env.get("ORBIT_URL") or "http://127.0.0.1:3000")
        self.host, self.port = u.hostname or "127.0.0.1", u.port or 3000
        if self.host not in ("127.0.0.1", "localhost", "::1"):
            raise SystemExit("ORBIT_URL must be on this PC (loopback)")
        self.env_off = (env.get("ORBIT_WAKE", "") or "").strip().lower() in ("0", "off", "false", "no")
        self.vdir = data_dir() / "voice"
        self.vdir.mkdir(parents=True, exist_ok=True)
        self.token = ""
        self.on = False
        self.peripheral, self.every = False, 30
        self.pending: list[dict] = []
        self.state = "off"  # off | listening | thinking | speaking
        self.armed_until = 0.0
        self.busy = threading.Lock()
        self.conn: http.client.HTTPConnection | None = None
        self.cut = threading.Event()
        self.play_q: queue.Queue = queue.Queue()
        self.playing = threading.Event()
        self.audio_q: queue.Queue = queue.Queue(maxsize=200)
        self.vad = Vad(HERE / "models" / "silero_vad.onnx")
        self.seg = Segmenter()
        self.barge = Barge()
        self.log_file = self.vdir / "voice.log"

    def log(self, msg: str):
        line = time.strftime("%Y-%m-%d %H:%M:%S ") + msg  # never transcripts or window titles
        print(line, flush=True)
        try:
            if self.log_file.exists() and self.log_file.stat().st_size > 200_000:
                self.log_file.replace(self.log_file.with_suffix(".log.1"))
            with self.log_file.open("a", encoding="utf-8") as f:
                f.write(line + "\n")
        except OSError:
            pass

    def load_token(self) -> bool:
        try:
            t = (self.vdir / "token").read_text().strip()
        except OSError:
            return False
        self.token = t if len(t) == 64 else ""
        return bool(self.token)

    # -- ORBIT calls ---------------------------------------------------------------------------------------------------------
    def orbit(self, method: str, path: str, body: bytes | None = None, headers: dict | None = None, timeout=10):
        c = http.client.HTTPConnection(self.host, self.port, timeout=timeout)
        h = {"x-orbit-voice-token": self.token, **(headers or {})}
        if body is not None:
            h["content-length"] = str(len(body))
        c.request(method, path, body=body, headers=h)
        return c, c.getresponse()

    def poll_loop(self):
        while True:
            try:
                if not self.token and not self.load_token():
                    self.set_on(False)
                    time.sleep(5)
                    continue
                idle = idle_ms()
                c, r = self.orbit("GET", f"/api/voice/desk?op=poll{'' if idle is None else f'&idle={idle}'}", timeout=60)
                j = json.loads(r.read() or b"{}")
                c.close()
                if r.status == 403:
                    self.token = ""
                    continue
                self.set_on(bool(j.get("on")) and not self.env_off)
                self.peripheral, self.every = bool(j.get("peripheral")), int(j.get("everySec") or 30)
                self.pending = j.get("pending") or []
                say = j.get("say")
                if say and say.get("audio") and self.on and not self.busy.locked() and not self.playing.is_set():
                    self.log("ping spoken")
                    self.play_q.put(base64.b64decode(say["audio"]))
                    self.armed_until = time.time() + self.FOLLOW_S + 6
            except (OSError, ValueError, http.client.HTTPException):
                self.set_on(False)  # ORBIT not running
            time.sleep(5)

    def glance_loop(self):
        while True:
            time.sleep(max(10, self.every))
            if not (self.on and self.peripheral):
                continue
            w = active_window()
            if private_window(w["app"], w["title"]):
                continue  # never even reported
            try:
                c, r = self.orbit("POST", "/api/voice/desk?op=glance", json.dumps(w).encode(), {"content-type": "application/json"})
                r.read()
                c.close()
            except (OSError, http.client.HTTPException):
                pass

    def set_on(self, on: bool):
        if on != self.on:
            self.on = on
            self.log("listening" if on else "off")
            self.seg.reset()
        if not on:
            self.state = "off"
        elif self.state == "off":
            self.state = "listening"

    # -- Audio ---------------------------------------------------------------------------------------------------------------
    def mic_loop(self):
        import sounddevice as sd
        stream = None
        while True:
            if self.on and stream is None:
                try:
                    stream = sd.InputStream(samplerate=RATE, channels=1, dtype="float32", blocksize=BLOCK,
                                            callback=lambda d, *_: self.audio_q.put_nowait(d[:, 0].copy()) if not self.audio_q.full() else None)
                    stream.start()
                except Exception as e:  # no microphone
                    self.log(f"microphone unavailable: {type(e).__name__}")
                    stream = None
                    time.sleep(10)
                    continue
            if not self.on and stream is not None:
                stream.stop(); stream.close(); stream = None  # the mic is closed while off
                self.vad.reset()
            try:
                f = self.audio_q.get(timeout=0.5)
            except queue.Empty:
                continue
            if not self.on or len(f) != BLOCK:
                continue
            p = self.vad(f)
            if self.playing.is_set():
                level = float(np.sqrt(np.mean(f * f)))
                if self.barge.step(level, FRAME_MS, True, p > 0.5):
                    self.log("barge-in")
                    self.stop_speaking()
                    self.armed_until = time.time() + self.ARMED_S
                    self.seg.reset()
                    self.seg.push(f, 1.0)
                continue
            self.barge.step(0, FRAME_MS, False)
            if not self.seg.active:
                self.seg.max_s = 15.0 if time.time() < self.armed_until else 8.0  # a question after "Hey Orbit" may be longer
            u = self.seg.push(f, p)
            if u is not None and not self.busy.locked():
                threading.Thread(target=self.handle, args=(u,), daemon=True).start()

    def stop_speaking(self):
        import sounddevice as sd
        self.cut.set()
        while not self.play_q.empty():
            try:
                self.play_q.get_nowait()
            except queue.Empty:
                break
        sd.stop()
        c = self.conn
        if c:
            try:
                c.sock and c.sock.close()  # ORBIT sees the request end: CORE stops (callTurn abort)
            except OSError:
                pass

    def play_loop(self):
        import sounddevice as sd
        while True:
            data = self.play_q.get()
            try:
                x, rate = read_wav(data)
            except Exception:
                continue
            self.cut.clear()
            self.playing.set()
            self.state = "speaking"
            sd.play(x, rate)
            end = time.time() + len(x) / rate + 0.2
            while time.time() < end and not self.cut.is_set():
                time.sleep(0.03)
            sd.stop()
            if self.play_q.empty():
                self.playing.clear()
                self.state = "listening" if self.on else "off"

    def handle(self, audio: np.ndarray):
        with self.busy:
            armed = time.time() < self.armed_until  # right after "Hey Orbit" or an answer (a waiting OK is asked for, so it is armed too)
            w = active_window()
            win = {"app": "", "title": ""} if private_window(w["app"], w["title"]) else w
            try:
                self.cut.clear()
                c, r = self.orbit("POST", f"/api/voice/desk?op=hear{'&armed=1' if armed else ''}", wav_bytes(audio),
                                  {"content-type": "audio/wav", "x-orbit-window": urllib.parse.quote(json.dumps(win))}, timeout=300)
                self.conn = c
                if "ndjson" not in (r.getheader("content-type") or ""):
                    r.read(); c.close()
                    return
                self.state = "thinking"
                ended = False
                for raw in r:
                    if self.cut.is_set():
                        break
                    try:
                        ev = json.loads(raw)
                    except ValueError:
                        continue
                    t = ev.get("type")
                    if t == "armed":
                        self.armed_until = time.time() + self.ARMED_S
                    elif t == "say" and ev.get("audio"):
                        self.play_q.put(base64.b64decode(ev["audio"]))
                    elif t == "end":
                        ended = True
                c.close()
                while (self.playing.is_set() or not self.play_q.empty()) and not self.cut.is_set():
                    time.sleep(0.05)
                if not self.cut.is_set():
                    self.armed_until = 0 if ended else max(self.armed_until, time.time() + self.FOLLOW_S)
            except (OSError, http.client.HTTPException) as e:
                self.log(f"ORBIT request failed: {type(e).__name__}")
            finally:
                self.conn = None
                if not self.playing.is_set():
                    self.state = "listening" if self.on else "off"

    def confirm(self, pid: str, allow: bool):
        try:
            c, r = self.orbit("POST", "/api/voice/desk?op=confirm", json.dumps({"id": pid, "allow": allow}).encode(), {"content-type": "application/json"}, timeout=600)
            r.read(); c.close()
        except (OSError, http.client.HTTPException):
            pass
        self.pending = [p for p in self.pending if p.get("id") != pid]

    # -- Orb (always on top) -------------------------------------------------------------------------------------------------
    def orb(self):
        import tkinter as tk
        root = tk.Tk()
        root.overrideredirect(True)
        root.attributes("-topmost", True)
        bg = "#010203"
        root.configure(bg=bg)
        try:
            root.attributes("-transparentcolor", bg)
        except tk.TclError:
            pass
        size = 44
        root.geometry(f"{size}x{size}+{root.winfo_screenwidth() - size - 24}+{root.winfo_screenheight() - size - 72}")
        cv = tk.Canvas(root, width=size, height=size, bg=bg, highlightthickness=0)
        cv.pack()
        dot = cv.create_oval(6, 6, size - 6, size - 6, fill="#334155", outline="")
        colors = {"off": "#334155", "listening": "#22d3ee", "thinking": "#f59e0b", "speaking": "#a78bfa"}
        menu: dict = {"w": None}

        def show_confirm(_e=None):
            if not self.pending or menu["w"]:
                return
            p = self.pending[-1]
            w = tk.Toplevel(root)
            w.attributes("-topmost", True)
            w.title("ORBIT wants to act on your PC")
            tk.Label(w, text=f"ORBIT wants to {p.get('summary', '?')}", wraplength=320, padx=12, pady=10).pack()
            row = tk.Frame(w)
            row.pack(pady=8)

            def done(allow):
                menu["w"] = None
                w.destroy()
                threading.Thread(target=self.confirm, args=(p["id"], allow), daemon=True).start()
            tk.Button(row, text="Allow once", command=lambda: done(True)).pack(side="left", padx=6)
            tk.Button(row, text="Deny", command=lambda: done(False)).pack(side="left", padx=6)
            w.protocol("WM_DELETE_WINDOW", lambda: done(False))
            menu["w"] = w

        cv.bind("<Button-1>", show_confirm)

        def tick():
            st = "thinking" if self.state == "thinking" else self.state
            col = colors.get(st, "#334155")
            if self.pending:
                col = "#ef4444"  # waiting for his click
            cv.itemconfigure(dot, fill=col)
            root.after(150, tick)
        tick()
        root.mainloop()

    # -- Helper HTTP server (ORBIT -> this process) ---------------------------------------------------------------------------
    def serve(self) -> int:
        app = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _ok(self) -> bool:
                host = (self.headers.get("host") or "").split(":")[0]
                tok = self.headers.get("x-orbit-voice-token") or ""
                if host not in ("127.0.0.1", "localhost") or self.headers.get("origin") or not app.token or not hmac.compare_digest(tok, app.token):
                    self._send(403, {"error": "not allowed"})
                    return False
                return True

            def _send(self, code: int, obj: dict):
                b = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)

            def _body(self) -> dict:
                n = int(self.headers.get("content-length") or 0)
                if n > 100_000:
                    return {}
                try:
                    return json.loads(self.rfile.read(n) or b"{}")
                except ValueError:
                    return {}

            def do_GET(self):
                if not self._ok():
                    return
                if self.path == "/window":
                    w = active_window()
                    return self._send(200, {"app": "", "title": "", "private": True} if private_window(w["app"], w["title"]) else w)
                self._send(404, {"error": "unknown"})

            def do_POST(self):
                if not self._ok():
                    return
                body = self._body()
                if self.path == "/screenshot":
                    try:
                        j = screenshot_jpeg()
                    except Exception as e:
                        return self._send(500, {"error": f"capture failed: {type(e).__name__}"})
                    return self._send(200, {"private": True} if j is None else {"jpeg": base64.b64encode(j).decode()})
                if self.path in ("/act", "/undo"):
                    import pc_actions
                    folders = pc_actions.parse_folders((read_env_local().get("ORBIT_PC_FOLDERS") or os.environ.get("ORBIT_PC_FOLDERS") or ""))
                    fn = pc_actions.act if self.path == "/act" else pc_actions.undo
                    arg = body.get("args") if self.path == "/act" else body.get("undo")
                    try:
                        r = fn(str(body.get("action") or ""), arg if isinstance(arg, dict) else {}, folders)
                    except Exception as e:
                        r = {"ok": False, "text": f"{type(e).__name__}: {e}"[:300]}
                    app.log(f"pc {self.path[1:]} {body.get('action')} ok={r.get('ok')}")
                    return self._send(200, r)
                self._send(404, {"error": "unknown"})

        srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        port = srv.server_address[1]
        tmp = self.vdir / "helper.json.tmp"
        tmp.write_text(json.dumps({"port": port, "pid": os.getpid()}))
        tmp.replace(self.vdir / "helper.json")
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        return port

    def run(self, orb: bool = True):
        if self.env_off:
            self.log("ORBIT_WAKE=0: the listener stays off (the helper still answers ORBIT)")
        port = self.serve()
        self.log(f"helper on 127.0.0.1:{port}")
        for t in (self.poll_loop, self.glance_loop, self.mic_loop, self.play_loop):
            threading.Thread(target=t, daemon=True).start()
        if orb:
            self.orb()
        else:
            while True:
                time.sleep(3600)


def main(argv: list[str]):
    sys.path.insert(0, str(HERE))
    if len(argv) > 2 and argv[1] == "--file":  # offline check: which utterances would be sent from a 16 kHz WAV
        x, rate = read_wav(Path(argv[2]).read_bytes())
        if rate != RATE:
            raise SystemExit("16 kHz WAV only")
        us = utterances(Vad(HERE / "models" / "silero_vad.onnx"), x)
        print(json.dumps([round(len(u) / RATE, 2) for u in us]))
        return
    App().run(orb="--no-orb" not in argv)


if __name__ == "__main__":
    main(sys.argv)
