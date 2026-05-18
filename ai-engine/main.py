from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
import torch

# ── Compatibility shim ─────────────────────────────────────────────
# torch.xpu (Intel XPU device support) was added in PyTorch 2.4.
# F5-TTS checks it at import/init time; on CPU-only builds (torch 2.2.x)
# the attribute simply doesn't exist, causing an AttributeError.
# We stub it out so F5-TTS loads cleanly without needing a torch upgrade.
if not hasattr(torch, "xpu"):
    class _StubXPU:
        @staticmethod
        def is_available() -> bool:
            return False

        @staticmethod
        def device_count() -> int:
            return 0

        @staticmethod
        def _is_in_bad_fork() -> bool:
            return False

        @staticmethod
        def current_device() -> int:
            return 0

        @staticmethod
        def get_device_name(idx: int = 0) -> str:
            return ""

        def __call__(self, *args, **kwargs):
            return self

        def __getattr__(self, name: str):
            # Catch-all: return a no-op callable for any other method
            # F5-TTS may call on torch.xpu so we never get an AttributeError again.
            def _noop(*a, **kw):
                return False
            return _noop

    torch.xpu = _StubXPU()  # type: ignore[attr-defined]

import whisper
from TTS.api import TTS
import os
import re
import subprocess
import uuid
import tempfile
import numpy as np
import soundfile as sf

os.environ["COQUI_TOS_AGREED"] = "1"

models: dict = {"stt": None, "xtts": None, "f5tts": None}

VOICES_DIR = "voice_profiles"
os.makedirs(VOICES_DIR, exist_ok=True)

TMP_DIR = tempfile.gettempdir()


def tmp_path(prefix: str, suffix: str = "") -> str:
    return os.path.join(TMP_DIR, f"{prefix}_{uuid.uuid4().hex}{suffix}")


# ── Audio conversion ───────────────────────────────────────────────
def convert_to_wav(input_path: str, output_path: str, sample_rate: int = 22050) -> bool:
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", input_path,
                "-af", (
                    "highpass=f=80,"
                    "afftdn=nf=-25,"
                    "loudnorm=I=-16:TP=-1.5:LRA=11,"
                    "aresample=resampler=soxr"
                ),
                "-ar", str(sample_rate),
                "-ac", "1",
                "-f", "wav",
                "-acodec", "pcm_s16le",
                output_path,
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            result = subprocess.run(
                ["ffmpeg", "-y", "-i", input_path,
                 "-ar", str(sample_rate), "-ac", "1",
                 "-f", "wav", "-acodec", "pcm_s16le", output_path],
                capture_output=True, text=True, timeout=60,
            )
        return result.returncode == 0
    except Exception as e:
        print(f"FFmpeg conversion error: {e}")
        return False


def trim_silence(wav_path: str, top_db: float = 30.0) -> None:
    try:
        data, sr = sf.read(wav_path)
        if data.ndim > 1:
            data = data[:, 0]
        amp = np.abs(data)
        thresh = (10 ** (-top_db / 20)) * amp.max()
        nonzero = np.where(amp > thresh)[0]
        if len(nonzero) == 0:
            return
        start = max(0, nonzero[0] - int(0.05 * sr))
        end   = min(len(data), nonzero[-1] + int(0.05 * sr))
        sf.write(wav_path, data[start:end], sr, subtype="PCM_16")
    except Exception as e:
        print(f"Trim silence error (non-fatal): {e}")


# ── Text chunking ──────────────────────────────────────────────────
def split_into_chunks(text: str, max_chars: int = 220) -> list[str]:
    raw = re.split(r'(?<=[.!?…])\s+', text.strip())
    chunks: list[str] = []
    current = ""
    for sentence in raw:
        sentence = sentence.strip()
        if not sentence:
            continue
        candidate = (current + " " + sentence).strip() if current else sentence
        if len(candidate) <= max_chars:
            current = candidate
        else:
            if current:
                chunks.append(current)
            if len(sentence) > max_chars:
                sub = re.split(r'(?<=[,;])\s+', sentence)
                buf = ""
                for part in sub:
                    trial = (buf + " " + part).strip() if buf else part
                    if len(trial) <= max_chars:
                        buf = trial
                    else:
                        if buf:
                            chunks.append(buf)
                        buf = part
                current = buf
            else:
                current = sentence
    if current:
        chunks.append(current)
    return [c for c in chunks if c.strip()]


def concatenate_wavs(wav_paths: list[str], output_path: str, gap_ms: int = 60) -> bool:
    try:
        arrays, sr = [], None
        for p in wav_paths:
            data, file_sr = sf.read(p)
            if data.ndim > 1:
                data = data[:, 0]
            sr = file_sr
            arrays.append(data.astype(np.float32))

        if not arrays or sr is None:
            return False

        gap = np.zeros(int(sr * gap_ms / 1000), dtype=np.float32)
        merged = arrays[0]
        for chunk in arrays[1:]:
            merged = np.concatenate([merged, gap, chunk])

        peak = np.abs(merged).max()
        if peak > 0:
            merged = merged * (10 ** (-3 / 20)) / peak

        sf.write(output_path, merged, sr, subtype="PCM_16")
        return True
    except Exception as e:
        print(f"Concatenation error: {e}")
        return False


# ── F5-TTS synthesis helper ────────────────────────────────────────
def synthesize_chunk_f5(chunk: str, ref_wav: str, speed: float, chunk_path: str) -> None:
    """
    Synthesize a single text chunk using F5-TTS and save to chunk_path.
    Handles multiple F5-TTS API versions gracefully.
    """
    f5 = models["f5tts"]
    if f5 is None:
        raise RuntimeError("F5-TTS model not loaded")

    wav = None
    sr = 24000  # F5-TTS default sample rate

    # ── Try modern API (f5-tts >= 0.9) ────────────────────────────
    try:
        result = f5.infer(
            ref_file=ref_wav,
            ref_text="",          # auto-transcription from ref audio
            gen_text=chunk,
            speed=max(0.5, min(2.0, speed)),
            target_rms=0.1,
            cross_fade_duration=0.15,
        )
        # infer() returns (wav_array, sample_rate, spectrogram)
        if isinstance(result, (tuple, list)) and len(result) >= 2:
            wav, sr = result[0], int(result[1])
        else:
            wav = result
    except TypeError:
        # ── Fallback: minimal kwargs (older API) ───────────────────
        try:
            result = f5.infer(
                ref_file=ref_wav,
                ref_text="",
                gen_text=chunk,
            )
            if isinstance(result, (tuple, list)) and len(result) >= 2:
                wav, sr = result[0], int(result[1])
            else:
                wav = result
        except Exception as e2:
            raise RuntimeError(f"F5-TTS infer() failed: {e2}") from e2
    except Exception as e:
        raise RuntimeError(f"F5-TTS infer() error: {e}") from e

    if wav is None:
        raise RuntimeError("F5-TTS returned no audio data")

    # ── Normalise to numpy float32 ─────────────────────────────────
    if hasattr(wav, "cpu"):          # torch tensor
        wav = wav.cpu().numpy()
    wav = np.array(wav, dtype=np.float32)

    # Flatten — take first channel if stereo / batch dim
    if wav.ndim > 1:
        wav = wav.reshape(-1) if wav.shape[0] == 1 else wav[0]

    if wav.size == 0:
        raise RuntimeError("F5-TTS produced empty audio array")

    sf.write(chunk_path, wav, sr, subtype="PCM_16")


# ── Model loading ──────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app):
    await load_all_models()
    yield


app = FastAPI(lifespan=lifespan)

# ── CORS ───────────────────────────────────────────────────────────
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    # Production EC2 origins (nginx proxies the browser → this engine)
    "https://3.83.53.113",
    "http://3.83.53.113",
    "http://3.83.53.113:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def load_all_models():
    print("--- Initializing AI Suite ---")

    # Whisper STT
    try:
        print("Loading Whisper (STT)…")
        models["stt"] = whisper.load_model("base", device="cpu")
        print("✓ Whisper ready")
    except Exception as e:
        print(f"✗ Whisper failed: {e}")

    # XTTS v2
    try:
        print("Loading XTTS v2 (TTS/Cloning)…")
        models["xtts"] = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cpu")
        print("✓ XTTS v2 ready")
    except Exception as e:
        print(f"✗ XTTS v2 failed: {e}")

    # F5-TTS — optional, graceful fallback
    # The torch.xpu shim at the top of this file ensures F5-TTS can import
    # cleanly on CPU-only torch 2.2.x builds.
    # Tries multiple import paths for different package versions.
    f5_loaded = False
    for import_path in [
        ("f5_tts.api", "F5TTS"),
        ("f5_tts",     "F5TTS"),
        ("f5tts",      "F5TTS"),
    ]:
        module_name, class_name = import_path
        try:
            import importlib
            mod = importlib.import_module(module_name)
            F5TTSClass = getattr(mod, class_name)
            print(f"Loading F5-TTS (from {module_name})…")
            models["f5tts"] = F5TTSClass()
            print("✓ F5-TTS ready")
            f5_loaded = True
            break
        except ImportError:
            continue
        except Exception as e:
            print(f"✗ F5-TTS failed to load from {module_name}: {e}")
            break

    if not f5_loaded:
        print("ℹ F5-TTS not installed — XTTS v2 remains available")
        print("  To enable: pip install f5-tts")

    print("--- Model Loading Complete ---")


# ── Status ────────────────────────────────────────────────────────
@app.get("/")
async def status():
    return {
        "status": "Online",
        "features": {
            "transcription":       "Ready" if models["stt"]   else "Unavailable",
            "voice_cloning_xtts":  "Ready" if models["xtts"]  else "Unavailable",
            "voice_cloning_f5":    "Ready" if models["f5tts"] else "Unavailable",
        },
        "engines": {
            "xtts": models["xtts"]  is not None,
            "f5":   models["f5tts"] is not None,
        },
    }


# ── FEATURE 1: TRANSCRIPTION ──────────────────────────────────────
@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    if not models["stt"]:
        raise HTTPException(503, "Transcription model still loading…")

    raw_path = tmp_path("stt_raw")
    wav_path = tmp_path("stt", ".wav")

    try:
        with open(raw_path, "wb") as b:
            b.write(await file.read())

        if not convert_to_wav(raw_path, wav_path):
            raise HTTPException(400, "Could not convert audio.")

        result = models["stt"].transcribe(wav_path)
        return {"text": result["text"]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        for p in [raw_path, wav_path]:
            if os.path.exists(p):
                os.remove(p)


# ── FEATURE 2: SAVE VOICE PROFILE ────────────────────────────────
@app.post("/voice-profile/save")
async def save_voice_profile(
    file: UploadFile = File(...),
    profile_id: str = Form(...),
):
    raw_path = tmp_path("voice_raw")
    wav_path = os.path.join(VOICES_DIR, f"{profile_id}.wav")

    try:
        with open(raw_path, "wb") as b:
            b.write(await file.read())

        if not convert_to_wav(raw_path, wav_path, sample_rate=22050):
            raise HTTPException(400, "Could not convert audio.")

        trim_silence(wav_path, top_db=35)

        probe = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                wav_path,
            ],
            capture_output=True, text=True,
        )
        duration = float(probe.stdout.strip()) if probe.stdout.strip() else 0

        warning = None
        if duration < 6:
            warning = f"Recording is only {duration:.1f}s — both engines need 6-30 s for best quality."
        elif duration > 30:
            warning = "Recording is over 30 s — consider trimming to the best 10-20 s."

        return {
            "success": True,
            "profile_id": profile_id,
            "duration_seconds": round(duration, 2),
            "warning": warning,
            "message": "Voice profile saved successfully.",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        if os.path.exists(raw_path):
            os.remove(raw_path)


# ── FEATURE 3: LIST VOICE PROFILES ───────────────────────────────
@app.get("/voice-profile/list")
async def list_voice_profiles():
    profiles = []
    for f in os.listdir(VOICES_DIR):
        if f.endswith(".wav"):
            profiles.append({"profile_id": f[:-4], "filename": f})
    return {"profiles": profiles}


# ── FEATURE 4: SYNTHESIZE (XTTS v2 or F5-TTS) ────────────────────
@app.post("/synthesize")
async def synthesize(
    text: str          = Form(...),
    profile_id: str    = Form(...),
    language: str      = Form(default="en"),
    tts_engine: str    = Form(default="xtts"),   # "xtts" | "f5"
    # XTTS-specific knobs (ignored by F5-TTS)
    temperature: float = Form(default=0.65),
    top_k: int         = Form(default=50),
    top_p: float       = Form(default=0.85),
    speed: float       = Form(default=1.0),
    gap_ms: int        = Form(default=60),
):
    ref_wav = os.path.join(VOICES_DIR, f"{profile_id}.wav")
    if not os.path.exists(ref_wav):
        raise HTTPException(404, f"Voice profile '{profile_id}' not found.")

    chunks = split_into_chunks(text.strip())
    if not chunks:
        raise HTTPException(400, "No text to synthesise.")

    engine = tts_engine.lower().strip()
    if engine not in ("xtts", "f5"):
        engine = "xtts"

    # Guard: check the requested engine is available
    if engine == "f5" and not models["f5tts"]:
        raise HTTPException(
            503,
            "F5-TTS is not available on this server. "
            "Install it with: pip install f5-tts  — or switch to XTTS v2 in Settings."
        )
    if engine == "xtts" and not models["xtts"]:
        raise HTTPException(503, "XTTS v2 model is not available.")

    chunk_paths: list[str] = []
    out_path = tmp_path("synth_final", ".wav")

    try:
        for i, chunk in enumerate(chunks):
            chunk_path = tmp_path(f"synth_chunk_{i}", ".wav")
            chunk_paths.append(chunk_path)

            if engine == "f5":
                # ── F5-TTS path ──────────────────────────────────
                synthesize_chunk_f5(
                    chunk=chunk,
                    ref_wav=ref_wav,
                    speed=speed,
                    chunk_path=chunk_path,
                )
            else:
                # ── XTTS v2 path ─────────────────────────────────
                models["xtts"].tts_to_file(
                    text=chunk,
                    speaker_wav=ref_wav,
                    language=language,
                    file_path=chunk_path,
                    temperature=max(0.1, min(1.0, temperature)),
                    top_k=max(1, min(100, top_k)),
                    top_p=max(0.1, min(1.0, top_p)),
                    speed=max(0.5, min(2.0, speed)),
                    enable_text_splitting=False,
                )

        # Merge chunks
        if len(chunk_paths) == 1:
            import shutil
            shutil.copy(chunk_paths[0], out_path)
        else:
            if not concatenate_wavs(chunk_paths, out_path, gap_ms=gap_ms):
                raise HTTPException(500, "Failed to merge audio chunks.")

        return FileResponse(
            out_path,
            media_type="audio/wav",
            headers={"Content-Disposition": "attachment; filename=synthesized.wav"},
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"Synthesis error [{engine}]: {e}")
        raise HTTPException(500, f"Synthesis failed ({engine}): {e}")
    finally:
        for p in chunk_paths:
            if os.path.exists(p):
                os.remove(p)


# ── LEGACY: CLONE-VOICE (one-shot, kept for compatibility) ────────
@app.post("/clone-voice")
async def clone(
    text: str = Form(...),
    file: UploadFile = File(...),
):
    if not models["xtts"]:
        raise HTTPException(503, "Cloning model still loading…")

    raw_path = tmp_path("ref_raw")
    ref_path = tmp_path("ref", ".wav")
    out_path = tmp_path("clone", ".wav")

    try:
        with open(raw_path, "wb") as b:
            b.write(await file.read())

        if not convert_to_wav(raw_path, ref_path):
            raise HTTPException(400, "Could not convert reference audio.")

        trim_silence(ref_path)

        chunks = split_into_chunks(text.strip()) or [text.strip()]
        chunk_paths = []
        for i, chunk in enumerate(chunks):
            cp = tmp_path(f"clone_chunk_{i}", ".wav")
            chunk_paths.append(cp)
            models["xtts"].tts_to_file(
                text=chunk,
                speaker_wav=ref_path,
                language="en",
                file_path=cp,
                temperature=0.65,
                top_k=50,
                top_p=0.85,
                enable_text_splitting=False,
            )

        if len(chunk_paths) == 1:
            import shutil
            shutil.copy(chunk_paths[0], out_path)
        else:
            concatenate_wavs(chunk_paths, out_path)

        return FileResponse(out_path, media_type="audio/wav")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Cloning failed: {e}")
    finally:
        for p in [raw_path, ref_path] + chunk_paths:
            if os.path.exists(p):
                os.remove(p)