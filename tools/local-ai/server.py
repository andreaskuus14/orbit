"""ORBIT local AI service: free models on this PC, nothing leaves the machine except the one-time weight downloads.

Listens on 127.0.0.1 only. One job at a time and every GPU model is unloaded after its job, so a 6 GB laptop GPU
never holds two models. Endpoints: /health, /image-to-3d, /remove-bg, /tts, /clone-tts, and the optional modules
/transcribe (captions), /ifc-summary (IFC models), /doc-to-md (document reading); see README.md.

UNTESTED ON A GPU: written and syntax-checked in a cloud box without CUDA or Windows. setup.ps1 installs what this imports.
"""
from __future__ import annotations

import gc
import importlib.util
import io
import os
import sys
import tempfile
import threading
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

HERE = Path(__file__).resolve().parent
MODELS = HERE / "models"
TRIPOSR_SRC = HERE / "vendor" / "TripoSR"
os.environ.setdefault("U2NET_HOME", str(MODELS / "rembg"))  # keep rembg's cut-out model with the others
os.environ.setdefault("HF_HOME", str(MODELS / "hf"))  # same cache setup.ps1 filled (TripoSR reads the DINO config from it)
os.environ.setdefault("HF_HUB_OFFLINE", "1")  # weights come from setup.ps1; no Hub calls while running

MAX_IMAGE = 15 * 1024 * 1024
MAX_SAMPLE = 20 * 1024 * 1024
MAX_TTS_CHARS = 5000
MAX_CLONE_CHARS = 600  # Audio8 shares ~2048 positions between sample, transcript and new text: split longer scripts
# TripoSR renders the triplane in chunks; 8192 is the default (~6 GB). Half of it trades speed for headroom on 6 GB cards.
CHUNK = int(os.environ.get("ORBIT_TRIPOSR_CHUNK", "4096"))
VOICES = {"af_heart", "af_bella", "af_sarah", "am_michael", "am_fenrir", "bf_emma", "bm_george"}  # Kokoro presets ORBIT offers
# Optional modules (setup.ps1 -Captions / -Ifc / -Docs). Files are spooled to a temp file, never held whole in memory.
WHISPER_DIR = MODELS / "whisper-large-v3-turbo"
DOCLING_DIR = MODELS / "docling"
MAX_MEDIA = 200 * 1024 * 1024
MAX_IFC = 100 * 1024 * 1024
MAX_DOC = 50 * 1024 * 1024
MAX_DOC_PAGES = 300
CAPTION_LANGS = {"auto": None, "en": "en", "et": "et"}
DOC_TYPES = {".pdf", ".docx", ".pptx", ".png", ".jpg", ".jpeg"}

app = FastAPI(title="ORBIT local AI")
_job = threading.Lock()
_kokoro = None  # CPU model, ~330 MB RAM: kept between jobs


def has(mod: str) -> bool:
    try:
        return importlib.util.find_spec(mod) is not None
    except (ImportError, ValueError):
        return False


def torch_mod():
    try:
        import torch
        return torch
    except Exception:
        return None


def device() -> str:
    t = torch_mod()
    return "cuda:0" if t is not None and t.cuda.is_available() else "cpu"


def free_vram() -> None:
    gc.collect()
    t = torch_mod()
    if t is not None and t.cuda.is_available():
        t.cuda.empty_cache()


class Busy:
    """One job at a time: a second request gets 409 instead of queueing behind a long 3D job."""

    def __enter__(self):
        if not _job.acquire(timeout=2):
            raise HTTPException(409, "Busy with another job. Try again when it finishes.")

    def __exit__(self, *exc):
        free_vram()
        _job.release()


def need(ok: bool, what: str) -> None:
    if not ok:
        raise HTTPException(503, f"{what} is not installed. Run tools/local-ai/setup.ps1.")


def read_capped(f: UploadFile, cap: int, what: str) -> bytes:
    data = f.file.read(cap + 1)
    if not data:
        raise HTTPException(400, f"No {what} received.")
    if len(data) > cap:
        raise HTTPException(413, f"The {what} is too big (max {cap // (1024 * 1024)} MB).")
    return data


def wav_bytes(samples, rate: int) -> bytes:
    import soundfile as sf
    buf = io.BytesIO()
    sf.write(buf, samples, rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def installed() -> dict:
    return {
        "image3d": (TRIPOSR_SRC / "tsr").is_dir() and (MODELS / "TripoSR" / "model.ckpt").is_file() and has("torchmcubes"),
        "removebg": has("rembg"),
        "tts": has("kokoro_onnx") and (MODELS / "kokoro" / "kokoro-v1.0.onnx").is_file(),
        "clone": has("transformers") and (MODELS / "audio8" / "model.safetensors").is_file(),
        "captions": has("faster_whisper") and (WHISPER_DIR / "model.bin").is_file(),
        "ifc": has("ifcopenshell"),
        "docs": has("docling") and (DOCLING_DIR / "ready.txt").is_file(),
    }


def spool(f: UploadFile, cap: int, what: str, suffix: str) -> str:
    """Upload → temp file (capped), so a 200 MB video never sits in RAM. Caller deletes it."""
    fd, path = tempfile.mkstemp(suffix=suffix)
    n = 0
    try:
        with os.fdopen(fd, "wb") as out:
            while chunk := f.file.read(1024 * 1024):
                n += len(chunk)
                if n > cap:
                    raise HTTPException(413, f"The {what} is too big (max {cap // (1024 * 1024)} MB).")
                out.write(chunk)
        if not n:
            raise HTTPException(400, f"No {what} received.")
        return path
    except BaseException:
        os.unlink(path)
        raise


@app.get("/health")
def health():
    t = torch_mod()
    gpu = None
    if t is not None and t.cuda.is_available():
        p = t.cuda.get_device_properties(0)
        gpu = {"name": p.name, "vramGb": round(p.total_memory / 2**30, 1)}
    return {"ok": True, "service": "orbit-local-ai", "version": 1, "gpu": gpu, "busy": _job.locked(), "tools": installed()}


@app.post("/remove-bg")
def remove_bg(image: UploadFile = File(...)):
    need(installed()["removebg"], "Background cut-out")
    data = read_capped(image, MAX_IMAGE, "picture")
    with Busy():
        import rembg
        return Response(rembg.remove(data), media_type="image/png")


@app.post("/image-to-3d")
def image_to_3d(image: UploadFile = File(...), resolution: int = Form(256)):
    need(installed()["image3d"], "Picture to 3D (TripoSR)")
    if resolution not in (128, 192, 256, 320):
        raise HTTPException(400, "resolution must be 128, 192, 256 or 320")
    data = read_capped(image, MAX_IMAGE, "picture")
    with Busy():
        import numpy as np
        import rembg
        import torch
        from PIL import Image
        if str(TRIPOSR_SRC) not in sys.path:
            sys.path.insert(0, str(TRIPOSR_SRC))
        from tsr.system import TSR
        from tsr.utils import remove_background, resize_foreground

        try:
            img = Image.open(io.BytesIO(data))
            img.load()
        except Exception:
            raise HTTPException(400, "That file isn't a picture ORBIT can read (use PNG, JPG or WebP).")
        dev = device()
        # torch >= 2.6 loads with weights_only=True, which TripoSR's checkpoint fails; it is the revision-pinned
        # stabilityai/TripoSR file setup.ps1 downloaded, so the full load is allowed for this one call only.
        _load = torch.load
        torch.load = lambda *a, **k: _load(*a, **{**k, "weights_only": False})
        try:
            model = TSR.from_pretrained(str(MODELS / "TripoSR"), config_name="config.yaml", weight_name="model.ckpt")
        finally:
            torch.load = _load
        try:
            model.renderer.set_chunk_size(CHUNK)
            model.to(dev)
            # Same preprocessing as TripoSR's run.py: cut out the subject, centre it, grey background.
            cut = resize_foreground(remove_background(img.convert("RGBA"), rembg.new_session()), 0.85)
            a = np.array(cut).astype(np.float32) / 255.0
            a = a[:, :, :3] * a[:, :, 3:4] + (1 - a[:, :, 3:4]) * 0.5
            with torch.no_grad():
                codes = model([Image.fromarray((a * 255.0).astype(np.uint8))], device=dev)
                mesh = model.extract_mesh(codes, True, resolution=resolution)[0]
            glb = mesh.export(file_type="glb")
        except torch.cuda.OutOfMemoryError:
            raise HTTPException(507, "The GPU ran out of memory. Close games/browsers using the GPU, or set ORBIT_TRIPOSR_CHUNK=2048 and restart.")
        finally:
            del model
    return Response(glb, media_type="model/gltf-binary")


class TtsIn(BaseModel):
    text: str
    voice: str = "af_heart"
    speed: float = 1.0


@app.post("/tts")
def tts(body: TtsIn):
    global _kokoro
    need(installed()["tts"], "Voiceover (Kokoro)")
    text = body.text.strip()
    if not text or len(text) > MAX_TTS_CHARS:
        raise HTTPException(400, f"Text must be 1-{MAX_TTS_CHARS} characters.")
    if body.voice not in VOICES:
        raise HTTPException(400, f"Unknown voice. Pick one of: {', '.join(sorted(VOICES))}")
    if not 0.5 <= body.speed <= 2.0:
        raise HTTPException(400, "speed must be 0.5-2.0")
    with Busy():
        if _kokoro is None:
            from kokoro_onnx import Kokoro
            _kokoro = Kokoro(str(MODELS / "kokoro" / "kokoro-v1.0.onnx"), str(MODELS / "kokoro" / "voices-v1.0.bin"))
        samples, rate = _kokoro.create(text, voice=body.voice, speed=body.speed, lang="en-gb" if body.voice.startswith("b") else "en-us")
        return Response(wav_bytes(samples, rate), media_type="audio/wav")


@app.post("/clone-tts")
def clone_tts(sample: UploadFile = File(...), sample_text: str = Form(...), text: str = Form(...), consent: str = Form("")):
    # ORBIT only offers this for the owner's own voice; the service refuses without that statement too.
    if consent != "own-voice":
        raise HTTPException(403, "Voice cloning is only for your own voice: confirm the sample is you.")
    need(installed()["clone"], "Own-voice cloning (Audio8)")
    text, sample_text = text.strip(), sample_text.strip()
    if not text or len(text) > MAX_CLONE_CHARS:
        raise HTTPException(400, f"Text must be 1-{MAX_CLONE_CHARS} characters per take (split longer scripts).")
    if not sample_text:
        raise HTTPException(400, "Type exactly what you said in the sample.")
    data = read_capped(sample, MAX_SAMPLE, "voice sample")
    with Busy():
        import torch
        from transformers import AutoModel, AutoProcessor
        dev = device()
        src = str(MODELS / "audio8")
        processor = AutoProcessor.from_pretrained(src, trust_remote_code=True)
        model = AutoModel.from_pretrained(src, trust_remote_code=True, dtype=torch.bfloat16 if dev != "cpu" else torch.float32).eval().to(dev)
        fd, ref = tempfile.mkstemp(suffix=".wav")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            inputs = processor(text=[text], reference_audio=[ref], reference_text=[sample_text], return_tensors="pt").to(dev)
            with torch.inference_mode():
                out = model.generate(**inputs, max_new_tokens=1024, do_sample=True, temperature=0.8, top_p=0.95, top_k=50, return_dict_in_generate=True)
                waves, lengths = model.decode_audio(out.codes)
            audio = waves[0, : int(lengths[0])].float().cpu().numpy()
            rate = int(model.config.codec_sample_rate)
        except torch.cuda.OutOfMemoryError:
            raise HTTPException(507, "The GPU ran out of memory. Close games/browsers using the GPU and try a shorter take.")
        except RuntimeError as e:
            if "Format not recognised" in str(e) or "Error opening" in str(e):
                raise HTTPException(400, "The voice sample must be a WAV file.")
            raise
        finally:
            os.unlink(ref)
            del model
    return Response(wav_bytes(audio, rate), media_type="audio/wav")


def whisper(dev: str):
    """faster-whisper large-v3-turbo. GPU: float16 (CTranslate2 has no INT8 on RTX 50 / sm_120, so int8_float16 only where offered)."""
    torch_mod()  # Windows: importing torch puts torch\lib (cuBLAS 12.8 + cuDNN 9 DLLs) on the DLL path CTranslate2 loads from
    import ctranslate2
    from faster_whisper import WhisperModel
    if dev == "cpu":
        return WhisperModel(str(WHISPER_DIR), device="cpu", compute_type="int8"), "cpu int8"
    ct = "int8_float16" if "int8_float16" in ctranslate2.get_supported_compute_types("cuda") else "float16"
    return WhisperModel(str(WHISPER_DIR), device="cuda", compute_type=ct), f"gpu {ct}"


@app.post("/transcribe")
def transcribe(file: UploadFile = File(...), language: str = Form("auto")):
    need(installed()["captions"], "Captions (faster-whisper)")
    if language not in CAPTION_LANGS:
        raise HTTPException(400, "language must be auto, en or et")
    path = spool(file, MAX_MEDIA, "audio or video file", Path(file.filename or "").suffix[:8] or ".bin")
    try:
        with Busy():
            devs = ["cuda", "cpu"] if device() != "cpu" else ["cpu"]
            for dev in devs:
                model = None
                try:
                    model, used = whisper(dev)
                    segs, info = model.transcribe(path, language=CAPTION_LANGS[language], word_timestamps=True, vad_filter=True, beam_size=5)
                    out = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip(),
                            "words": [{"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word} for w in (s.words or [])]} for s in segs]
                    break
                except RuntimeError as e:
                    # A missing cuBLAS/cuDNN DLL or a full GPU shows up here (on load or first decode): the CPU still works, just slower.
                    if dev == devs[-1]:
                        raise
                    print(f"[captions] GPU failed, using the CPU: {e}", file=sys.stderr)
                except Exception as e:
                    if type(e).__module__.startswith("av"):  # PyAV: not audio/video, or no audio track
                        raise HTTPException(400, "ORBIT can't read sound from that file (use mp4, mov, mkv, webm, mp3, wav or m4a).")
                    raise
                finally:
                    del model
                    free_vram()
    finally:
        os.unlink(path)
    return {"language": info.language, "languageProbability": round(info.language_probability, 2), "duration": round(info.duration, 2), "device": used, "segments": out}


def ifc_report(m) -> dict:
    """Storeys, spaces with areas, element counts, materials and simple checks of an opened IFC model (CPU only)."""
    from collections import Counter
    import ifcopenshell.util.element as ue
    import ifcopenshell.util.unit as uu
    length = uu.calculate_unit_scale(m)  # project length unit → metres
    try:
        area = uu.calculate_unit_scale(m, "AREAUNIT")
    except Exception:
        area = length * length
    container = lambda e: getattr(ue.get_container(e) or ue.get_aggregate(e), "Name", None)

    storeys = [{"name": s.Name or "", "elevation": round((s.Elevation or 0) * length, 3),
                "elements": sum(1 for x in ue.get_decomposition(s) if x.is_a("IfcElement"))}
               for s in sorted(m.by_type("IfcBuildingStorey"), key=lambda s: s.Elevation or 0)]
    spaces = []
    for s in m.by_type("IfcSpace"):
        a = None
        for q in ue.get_psets(s, qtos_only=True).values():
            for k in ("NetFloorArea", "GrossFloorArea"):
                if isinstance(q.get(k), (int, float)):
                    a = q[k]
                    break
            if a is not None:
                break
        spaces.append({"guid": s.GlobalId, "name": s.Name or "", "longName": s.LongName or "", "storey": container(s) or "",
                       "area": round(a * area, 2) if a is not None else None})
    elements = m.by_type("IfcElement")
    counts = Counter(e.is_a() for e in elements)
    used = Counter()
    for e in elements:
        for mat in {x.Name for x in ue.get_materials(e) if getattr(x, "Name", None)}:
            used[mat] += 1
    materials = [{"name": n, "elements": used[n]} for n in sorted({x.Name for x in m.by_type("IfcMaterial") if x.Name} | set(used), key=lambda n: -used[n])]

    issues = []
    def issue(kind, text, items):
        if items:
            issues.append({"kind": kind, "text": text, "count": len(items), "examples": items[:20]})
    guids = Counter(x.GlobalId for x in m.by_type("IfcRoot"))
    issue("duplicate-guid", "GlobalIds used more than once (BIM tools will mix these objects up)", [f"{g} ×{n}" for g, n in guids.items() if n > 1])
    issue("no-name", "Storeys, spaces or elements without a name",
          [f"{x.is_a()} {x.GlobalId}" for x in [*m.by_type("IfcBuildingStorey"), *m.by_type("IfcSpace"), *elements] if not (x.Name or "").strip() and not x.is_a("IfcOpeningElement")])
    issue("space-no-area", "Spaces without a floor area quantity (NetFloorArea/GrossFloorArea)", [f"{s['name'] or s['guid']}" for s in spaces if s["area"] is None])
    if not m.by_type("IfcBuildingStorey"):
        issue("no-storey", "No building storeys: elements aren't organised by floor", ["the model has no IfcBuildingStorey"])

    project = m.by_type("IfcProject")
    return {"schema": m.schema, "project": (project[0].Name or "") if project else "", "storeys": storeys, "spaces": spaces[:5000],
            "counts": dict(counts.most_common()), "materials": materials[:500], "issues": issues}


@app.post("/ifc-summary")
def ifc_summary(file: UploadFile = File(...)):
    need(installed()["ifc"], "IFC models (IfcOpenShell)")
    path = spool(file, MAX_IFC, "IFC file", ".ifc")
    try:
        with Busy():
            import ifcopenshell
            try:
                m = ifcopenshell.open(path)
            except Exception:
                raise HTTPException(400, "That file isn't an IFC model ORBIT can read (an .ifc file, IFC2X3 or IFC4).")
            return ifc_report(m)
    finally:
        os.unlink(path)


@app.post("/doc-to-md")
def doc_to_md(file: UploadFile = File(...), per_page: str = Form("")):
    need(installed()["docs"], "Document reading (Docling)")
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in DOC_TYPES:
        raise HTTPException(400, "ORBIT reads PDF, Word (.docx), PowerPoint (.pptx) and scanned pages (.png/.jpg).")
    path = spool(file, MAX_DOC, "document", suffix)
    try:
        with Busy():
            from docling.datamodel.accelerator_options import AcceleratorOptions
            from docling.datamodel.base_models import InputFormat
            from docling.datamodel.pipeline_options import PdfPipelineOptions
            from docling.document_converter import DocumentConverter, ImageFormatOption, PdfFormatOption
            import torch
            # Models come from models/docling (setup.ps1); HF_HUB_OFFLINE keeps it from fetching anything while running.
            opts = PdfPipelineOptions(artifacts_path=str(DOCLING_DIR), do_ocr=True, do_table_structure=True,
                                      accelerator_options=AcceleratorOptions(device="cuda" if device() != "cpu" else "cpu"))
            conv = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts), InputFormat.IMAGE: ImageFormatOption(pipeline_options=opts)})
            try:
                res = conv.convert(path, max_num_pages=MAX_DOC_PAGES, raises_on_error=False)
                if res.document is None or (suffix == ".pdf" and not res.pages):
                    raise HTTPException(400, f"ORBIT couldn't read that document ({res.status.value}). Is it a PDF with at most {MAX_DOC_PAGES} pages?")
                md = res.document.export_to_markdown()
                # VAULT intake: OCR/layout text of each page on its own, so extracted fields can cite a page
                by_page = [res.document.export_to_markdown(page_no=i) for i in range(1, len(res.pages) + 1)] if per_page == "1" else None
            except torch.cuda.OutOfMemoryError:
                raise HTTPException(507, "The GPU ran out of memory. Close games/browsers using the GPU and try again.")
            finally:
                del conv
    finally:
        os.unlink(path)
    out = {"markdown": md, "pages": len(res.pages), "status": res.status.value}
    if by_page is not None:
        out["byPage"] = by_page
    return out


@app.exception_handler(HTTPException)
def http_error(_req, exc: HTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("ORBIT_LOCAL_AI_PORT", "7861"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")  # loopback only: never reachable from the network
