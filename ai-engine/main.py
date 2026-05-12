from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:5173", "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

models = {"stt": None, "tts": None}

VOICES_DIR = "voice_profiles"
os.makedirs(VOICES_DIR, exist_ok=True)

TMP_DIR = tempfile.gettempdir()


def tmp_path(prefix: str, suffix: str = "") -> str:
    return os.path.join(TMP_DIR, f"{prefix}_{uuid.uuid4().hex}{suffix}")


# ── Audio conversion ───────────────────────────────────────────────
def convert_to_wav(input_path: str, output_path: str, sample_rate: int = 22050) -> bool:
    """
    Convert any audio → mono WAV at the given sample rate.
    Uses two-pass: first convert, then apply loudnorm for consistent levels.
    """
    try:
        # Pass 1: convert & normalise loudness (EBU R128 loudnorm)
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", input_path,
                "-af", (
                    "highpass=f=80,"           # remove rumble
                    "afftdn=nf=-25,"           # spectral noise reduction
                    "loudnorm=I=-16:TP=-1.5:LRA=11,"  # loudness normalisation
                    "aresample=resampler=soxr" # high-quality resampler
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
            # Fallback: plain conversion without filters
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
    """
    In-place trim of leading / trailing silence using numpy.
    top_db: threshold in dB below max – lower = more aggressive trim.
    """
    try:
        data, sr = sf.read(wav_path)
        if data.ndim > 1:
            data = data[:, 0]
        amp = np.abs(data)
        thresh = (10 ** (-top_db / 20)) * amp.max()
        nonzero = np.where(amp > thresh)[0]
        if len(nonzero) == 0:
            return
        start = max(0, nonzero[0] - int(0.05 * sr))   # 50 ms padding
        end   = min(len(data), nonzero[-1] + int(0.05 * sr))
        sf.write(wav_path, data[start:end], sr, subtype="PCM_16")
    except Exception as e:
        print(f"Trim silence error (non-fatal): {e}")


# ── Text chunking ──────────────────────────────────────────────────
# XTTS v2 works best with 1-3 sentences at a time (~100-300 chars).
# Longer inputs cause internal silent padding and prosody drift.

_SENTENCE_ENDINGS = re.compile(
    r'(?<=[.!?…])\s+(?=[A-Z"\'])|'   # after .!?… followed by capital
    r'(?<=\n)\s*(?=\S)',               # paragraph breaks
)

def split_into_chunks(text: str, max_chars: int = 220) -> list[str]:
    """
    Split text into natural sentence chunks ≤ max_chars.
    Merges short sentences so we don't over-fragment.
    """
    # First split on sentence boundaries
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
            # If a single sentence is still > max_chars, split on commas/semicolons
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
                if buf:
                    current = buf
                else:
                    current = ""
            else:
                current = sentence
    if current:
        chunks.append(current)
    return [c for c in chunks if c.strip()]


def concatenate_wavs(wav_paths: list[str], output_path: str,
                     gap_ms: int = 60) -> bool:
    """
    Concatenate multiple WAVs with a short silence gap between them.
    gap_ms: milliseconds of silence injected between chunks (avoids hard cuts).
    """
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

        # Light peak normalise to -3 dBFS
        peak = np.abs(merged).max()
        if peak > 0:
            merged = merged * (10 ** (-3 / 20)) / peak

        sf.write(output_path, merged, sr, subtype="PCM_16")
        return True
    except Exception as e:
        print(f"Concatenation error: {e}")
        return False


# ── Model loading ──────────────────────────────────────────────────
@app.on_event("startup")
async def load_all_models():
    print("--- Initializing AI Suite ---")
    try:
        print("Loading Whisper (STT)…")
        models["stt"] = whisper.load_model("base", device="cpu")
        print("Loading XTTS v2 (TTS/Cloning)…")
        models["tts"] = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cpu")
        print("--- All Models Ready ---")
    except Exception as e:
        print(f"Error during model loading: {e}")


@app.get("/")
async def status():
    return {
        "status": "Online",
        "features": {
            "transcription": "Ready" if models["stt"] else "Loading",
            "voice_cloning":  "Ready" if models["tts"] else "Loading",
        },
    }


# ── FEATURE 1: TRANSCRIPTION ───────────────────────────────────────
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
    """
    Save a voice recording as a named profile.
    We normalise + trim silence so XTTS gets clean reference audio.
    """
    raw_path = tmp_path("voice_raw")
    wav_path = os.path.join(VOICES_DIR, f"{profile_id}.wav")

    try:
        with open(raw_path, "wb") as b:
            b.write(await file.read())

        # Convert at 22 kHz (XTTS native rate) with loudnorm
        if not convert_to_wav(raw_path, wav_path, sample_rate=22050):
            raise HTTPException(400, "Could not convert audio.")

        # Trim leading / trailing silence
        trim_silence(wav_path, top_db=35)

        # Check duration
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
            warning = f"Recording is only {duration:.1f}s — XTTS needs 6-30 seconds for best quality."
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


# ── FEATURE 4: SYNTHESIZE WITH CHUNKING ──────────────────────────
@app.post("/synthesize")
async def synthesize(
    text: str = Form(...),
    profile_id: str = Form(...),
    language: str = Form(default="en"),
    # XTTS quality knobs — exposed so the frontend can tune them later
    temperature: float = Form(default=0.65),   # lower = more stable/consistent
    top_k: int     = Form(default=50),
    top_p: float   = Form(default=0.85),
    speed: float   = Form(default=1.0),        # 0.5 – 2.0
    # Gap injected between synthesised sentence chunks (ms)
    gap_ms: int    = Form(default=60),
):
    """
    Generate speech from text using a saved voice profile.
    Text is split into sentence chunks so XTTS never operates on a long
    passage — this eliminates the silent-gap artefact and improves
    voice-match consistency.
    """
    if not models["tts"]:
        raise HTTPException(503, "TTS model still loading…")

    ref_wav = os.path.join(VOICES_DIR, f"{profile_id}.wav")
    if not os.path.exists(ref_wav):
        raise HTTPException(404, f"Voice profile '{profile_id}' not found.")

    # Split input into manageable chunks
    chunks = split_into_chunks(text.strip())
    if not chunks:
        raise HTTPException(400, "No text to synthesise.")

    chunk_paths: list[str] = []
    out_path = tmp_path("synth_final", ".wav")

    try:
        for i, chunk in enumerate(chunks):
            chunk_path = tmp_path(f"synth_chunk_{i}", ".wav")
            chunk_paths.append(chunk_path)

            models["tts"].tts_to_file(
                text=chunk,
                speaker_wav=ref_wav,
                language=language,
                file_path=chunk_path,
                # --- XTTS inference parameters ---
                # temperature: lower → more faithful to reference timbre
                # (default 0.65 strikes a good balance; raise to 0.8+ for
                #  more expressive/varied delivery)
                temperature=max(0.1, min(1.0, temperature)),
                top_k=max(1, min(100, top_k)),
                top_p=max(0.1, min(1.0, top_p)),
                speed=max(0.5, min(2.0, speed)),
                # enable_text_splitting=False keeps us in control of chunks
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
        print(f"Synthesis error: {e}")
        raise HTTPException(500, f"Synthesis failed: {e}")
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
    if not models["tts"]:
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
            models["tts"].tts_to_file(
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