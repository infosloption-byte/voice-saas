"""
chatterbox-engine — standalone Chatterbox (Resemble AI, MIT-licensed) TTS
service, isolated from ai-engine's main.py in its own container.

WHY THIS IS A SEPARATE SERVICE, NOT PART OF ai-engine:
Chatterbox hard-pins torch==2.6.0 and transformers==4.46.3. ai-engine's
XTTS v2 needs transformers roughly in the 4.33-4.41 range and is pinned to
torch==2.2.2+cpu. Those pins don't overlap — `pip install chatterbox-tts`
inside ai-engine fails with a real pip ResolutionImpossible error. Rather
than fight that (or risk breaking XTTS by loosening its pin), Chatterbox
gets its own container with its own dependency set. ai-engine's
synthesize_chunk_chatterbox() calls this service over HTTP instead of
importing chatterbox directly.

Reference audio is uploaded as actual file bytes (multipart), not a
shared-volume path — some of ai-engine's callers use ephemeral local
/tmp files (e.g. the /clone-voice preview endpoint) that a separate
container has no way to see, so this avoids needing shared volumes
between the two services entirely.
"""
import os
import tempfile
from contextlib import asynccontextmanager

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException, Header, Form, UploadFile, File
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

CUDA_AVAILABLE = False
try:
    import torch
    CUDA_AVAILABLE = bool(getattr(torch, "cuda", None) and torch.cuda.is_available())
except Exception:
    pass

# Chatterbox Multilingual v3 covers 21 languages + 4 dialects as of the
# June 2026 release. Env override in case a future release changes coverage.
CHATTERBOX_LANGUAGES = [c.strip().lower() for c in os.getenv(
    "CHATTERBOX_LANGUAGES",
    "en,es,fr,de,it,pt,pl,tr,ru,nl,cs,ar,zh,ja,ko,hi,hu,vi,uk,el,sv,fi,he"
).split(",") if c.strip()]

_ENGINE_API_KEY = os.getenv("CHATTERBOX_ENGINE_API_KEY", os.getenv("AI_ENGINE_API_KEY", ""))
TMP_DIR = tempfile.gettempdir()
MAX_UPLOAD_BYTES = 25 * 1024 * 1024   # reference clips are short; 25MB is generous

model: "object | None" = None


def verify_api_key(x_engine_key: str = Header(default="")) -> None:
    """Same convention as ai-engine's verify_api_key. If no key is
    configured the check is skipped (local dev mode)."""
    if _ENGINE_API_KEY and x_engine_key != _ENGINE_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing engine API key.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    device = "cuda" if CUDA_AVAILABLE else "cpu"
    try:
        print(f"Loading Chatterbox (Multilingual, device={device})…")
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        model = ChatterboxMultilingualTTS.from_pretrained(device=device)
        print("✓ Chatterbox ready")
    except Exception as e:
        print(f"✗ Chatterbox failed to load: {e}")
        model = None
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["Content-Type", "Authorization", "X-Engine-Key"],
)


@app.get("/")
async def status():
    """Mirrors ai-engine's status shape closely enough for its
    chatterbox_usable() health check to parse directly."""
    return {
        "status": "Online",
        "engines": {
            "chatterbox": model is not None,
            "chatterbox_languages": CHATTERBOX_LANGUAGES if model is not None else [],
        },
        "gpu": CUDA_AVAILABLE,
    }


@app.post("/synthesize")
async def synthesize(
    text: str = Form(...),
    language_id: str = Form(default="en"),
    exaggeration: float = Form(default=0.5),
    cfg_weight: float = Form(default=0.5),
    temperature: float = Form(default=0.8),
    ref_audio: UploadFile | None = File(default=None),
    x_engine_key: str = Header(default=""),
):
    """Synthesize `text` and return a WAV file. ref_audio, if provided, is
    the actual reference clip's bytes — see module docstring for why this
    isn't a shared-volume path instead.

    IMPORTANT: model.generate() is synchronous, CPU/GPU-bound work that can
    run for many seconds on a longer segment (visible in this service's own
    logs as the "Sampling: N/1000" progress bar). This route is declared
    `async def`, and uvicorn runs all async routes on a single event loop
    thread — calling that blocking work directly here freezes the ENTIRE
    service for the duration of every synthesis call, including the
    unrelated GET / health check ai-engine polls every 15s to decide
    chatterbox_usable(). That produced a real production bug: mid-dubbing-
    job, a health check would queue up behind an in-flight synthesis call,
    miss ai-engine's 2s client timeout, get treated as "Chatterbox
    unavailable", and fail the NEXT segment with a 503 — even though this
    service was fully healthy and had just finished (or was about to
    finish) the previous segment successfully. run_in_threadpool moves the
    blocking call off the event loop so health checks keep getting served
    promptly while synthesis is in progress.
    """
    verify_api_key(x_engine_key)

    if model is None:
        raise HTTPException(503, "Chatterbox model is not loaded on this service.")
    if not text.strip():
        raise HTTPException(400, "No text to synthesise.")

    ref_wav_path = None
    if ref_audio is not None:
        raw = await ref_audio.read()
        if len(raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Reference audio too large.")
        ref_wav_path = os.path.join(TMP_DIR, f"chatterbox_ref_{os.getpid()}_{id(raw)}.wav")
        with open(ref_wav_path, "wb") as f:
            f.write(raw)

    out_path = None
    try:
        kwargs: dict = {
            "exaggeration": max(0.0, min(2.0, exaggeration)),
            "cfg_weight":   max(0.0, min(1.0, cfg_weight)),
            "temperature":  max(0.05, min(2.0, temperature)),
        }
        if ref_wav_path:
            kwargs["audio_prompt_path"] = ref_wav_path

        def _generate():
            try:
                return model.generate(text, language_id=language_id, **kwargs)
            except TypeError:
                # English-only Chatterbox build doesn't take language_id at all.
                return model.generate(text, **kwargs)

        wav = await run_in_threadpool(_generate)
    except Exception as e:
        raise HTTPException(500, f"Chatterbox generate() failed: {e}") from e
    finally:
        if ref_wav_path and os.path.exists(ref_wav_path):
            os.remove(ref_wav_path)

    if wav is None:
        raise HTTPException(500, "Chatterbox returned no audio data")

    sr = getattr(model, "sr", 24000)

    if hasattr(wav, "cpu"):          # torch tensor
        wav = wav.cpu().numpy()
    wav = np.array(wav, dtype=np.float32)
    if wav.ndim > 1:
        wav = wav.reshape(-1) if wav.shape[0] == 1 else wav[0]
    if wav.size == 0:
        raise HTTPException(500, "Chatterbox produced empty audio array")

    out_path = os.path.join(TMP_DIR, f"chatterbox_out_{os.getpid()}_{id(wav)}.wav")
    # sf.write is also blocking file I/O — offloaded for the same reason as
    # model.generate() above, though it's the smaller contributor here.
    await run_in_threadpool(sf.write, out_path, wav, sr, subtype="PCM_16")
    return FileResponse(out_path, media_type="audio/wav", filename="chatterbox.wav")
