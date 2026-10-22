"""
Vani voice server — custom and cloned voices for the Vani reader.

Runs on your own computer. Uses Chatterbox (Resemble AI, MIT license), an open-source
zero-shot voice-cloning TTS model: give it 10–30 seconds of someone speaking and it
can read anything in that voice.

Only clone your own voice, or a voice whose owner has given you permission.

HTTP API (used by the Vani app):
  GET  /health                       -> {"ok": true, "device": "cuda", "model_loaded": bool}
  GET  /voices                       -> [{"id", "name", "group"}]
  POST /voices   multipart: name, consent=true, file (WAV)   -> {"id", "name"}
  DELETE /voices/{id}
  POST /tts      json: {text, voice, speed=1, expressiveness=0.5}  -> audio/wav
  GET  /fetch?url=...                -> download helper for gutenberg.org EPUBs

Start:  python vani_voice_server.py   (listens on http://localhost:8765)
"""

import io
import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request as UrlRequest, urlopen

import numpy as np
import soundfile as sf
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

HERE = Path(__file__).resolve().parent
VOICES = Path(os.environ.get("VANI_VOICES_DIR", HERE / "voices"))
VOICES.mkdir(parents=True, exist_ok=True)
PORT = int(os.environ.get("VANI_PORT", "8765"))
HOST = os.environ.get("VANI_HOST", "127.0.0.1")

app = FastAPI(title="Vani voice server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def private_network_access(request: Request, call_next):
    # Lets the HTTPS-hosted Vani app (e.g. GitHub Pages) talk to this local server in Chrome.
    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


# ---------------------------------------------------------------------------
# Model (loaded lazily on first use, one generation at a time)
# ---------------------------------------------------------------------------
_model = None
_model_lock = threading.Lock()
_gen_lock = threading.Lock()


def device():
    import torch
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def model():
    global _model
    with _model_lock:
        if _model is None:
            from chatterbox.tts import ChatterboxTTS
            t = time.time()
            print(f"Loading Chatterbox on {device()} (first run downloads ~2 GB)…", flush=True)
            _model = ChatterboxTTS.from_pretrained(device=device())
            print(f"Model ready in {time.time() - t:.1f}s", flush=True)
    return _model


# ---------------------------------------------------------------------------
# Voices: voices/<id>/reference.wav + meta.json
# ---------------------------------------------------------------------------
def list_voices():
    out = []
    for d in sorted(VOICES.iterdir()):
        meta = d / "meta.json"
        if d.is_dir() and meta.exists() and (d / "reference.wav").exists():
            m = json.loads(meta.read_text(encoding="utf-8"))
            out.append({"id": d.name, "name": m.get("name", d.name), "group": "Your voices", "created": m.get("created")})
    return out


def voice_path(voice_id: str) -> Path:
    if not voice_id or not re.fullmatch(r"[a-zA-Z0-9_-]+", voice_id):
        raise HTTPException(404, "Unknown voice")
    p = VOICES / voice_id / "reference.wav"
    if not p.exists():
        raise HTTPException(404, "Unknown voice")
    return p


@app.get("/health")
def health():
    try:
        dev = device()
    except Exception as e:  # torch missing or broken
        dev = f"unavailable ({e})"
    return {"ok": True, "device": dev, "model_loaded": _model is not None, "voices": len(list_voices())}


@app.get("/voices")
def get_voices():
    return list_voices()


@app.post("/voices")
async def add_voice(name: str = Form(...), consent: str = Form(...), file: UploadFile = File(...)):
    if consent.lower() not in ("true", "1", "yes"):
        raise HTTPException(400, "Consent is required: only clone your own voice or one you have permission to use.")
    name = name.strip()[:60] or "My voice"
    raw = await file.read()
    if len(raw) > 30 * 1024 * 1024:
        raise HTTPException(413, "Recording is too large (max 30 MB).")
    try:
        audio, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
    except Exception:
        raise HTTPException(415, "Couldn't read that audio. Upload a WAV file (the Vani app converts recordings for you).")
    audio = audio.mean(axis=1)
    seconds = len(audio) / sr
    if seconds < 4:
        raise HTTPException(400, f"Recording is only {seconds:.1f}s — please record at least 10 seconds.")
    audio = audio[: int(sr * 40)]  # longer adds little
    peak = float(np.max(np.abs(audio))) or 1.0
    audio = (audio / peak * 0.95).astype("float32")

    vid = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:30] or "voice"
    vid = f"{vid}-{uuid.uuid4().hex[:6]}"
    d = VOICES / vid
    d.mkdir(parents=True)
    sf.write(d / "reference.wav", audio, sr)
    (d / "meta.json").write_text(json.dumps({"name": name, "created": time.time(), "seconds": round(seconds, 1), "consent": True}), encoding="utf-8")
    return {"id": vid, "name": name}


@app.delete("/voices/{voice_id}")
def delete_voice(voice_id: str):
    p = voice_path(voice_id).parent
    for f in p.iterdir():
        f.unlink()
    p.rmdir()
    return {"ok": True}


class TTSRequest(BaseModel):
    text: str
    voice: str | None = None
    speed: float = 1.0
    expressiveness: float = 0.5


@app.post("/tts")
def tts(req: TTSRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(400, "Empty text")
    if len(text) > 1500:
        raise HTTPException(413, "Text too long for one request")
    ref = voice_path(req.voice) if req.voice else None
    m = model()
    exaggeration = float(min(1.5, max(0.25, req.expressiveness)))
    # Higher expressiveness reads better with a slightly lower CFG weight (per Chatterbox docs).
    cfg = 0.5 if exaggeration <= 0.6 else 0.35
    with _gen_lock:
        kwargs = {"exaggeration": exaggeration, "cfg_weight": cfg}
        if ref:
            kwargs["audio_prompt_path"] = str(ref)
        wav = m.generate(text, **kwargs)
    audio = wav.squeeze().detach().cpu().numpy().astype("float32")
    sr = m.sr

    speed = float(min(2.5, max(0.5, req.speed or 1.0)))
    if abs(speed - 1.0) > 0.02:
        try:
            import librosa
            audio = librosa.effects.time_stretch(audio, rate=speed)
        except Exception as e:  # keep going at normal speed
            print("time-stretch unavailable:", e, flush=True)

    buf = io.BytesIO()
    sf.write(buf, audio, sr, format="WAV", subtype="PCM_16")
    return Response(buf.getvalue(), media_type="audio/wav")


# ---------------------------------------------------------------------------
# Download helper: lets the Vani app fetch public-domain EPUBs from Project Gutenberg
# (which doesn't send CORS headers). Restricted to gutenberg.org.
# ---------------------------------------------------------------------------
@app.get("/fetch")
def fetch(url: str = Query(...)):
    host = urlparse(url).hostname or ""
    if urlparse(url).scheme != "https" or not (host == "gutenberg.org" or host.endswith(".gutenberg.org")):
        raise HTTPException(403, "Only gutenberg.org downloads are allowed.")
    try:
        with urlopen(UrlRequest(url, headers={"User-Agent": "Vani/1.0"}), timeout=60) as r:
            data = r.read(80 * 1024 * 1024)
            ctype = r.headers.get("Content-Type", "application/epub+zip")
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)
    return Response(data, media_type=ctype)


if __name__ == "__main__":
    print(f"Vani voice server on http://localhost:{PORT}  (voices in {VOICES})", flush=True)
    if os.environ.get("VANI_PRELOAD", "1") == "1":
        threading.Thread(target=model, daemon=True).start()
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
