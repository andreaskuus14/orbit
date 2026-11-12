"""Runs Moonshine on WAV files. argv: model, wav... -> JSON {path: {text, sec}|{error}} on stdout. Run inside tools/trials/.venv."""
import json, sys, time
import moonshine_onnx
model, out = sys.argv[1], {}
for p in sys.argv[2:]:
    try:
        t = time.perf_counter(); r = moonshine_onnx.transcribe(p, model)
        out[p] = {"text": " ".join(r) if isinstance(r, list) else str(r), "sec": time.perf_counter() - t}
    except Exception as e:
        out[p] = {"error": f"{type(e).__name__}: {str(e)[:200]}"}
print(json.dumps(out))
