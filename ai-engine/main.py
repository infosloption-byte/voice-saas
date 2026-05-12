from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import whisper
from TTS.api import TTS
import os
import subprocess
import uuid
import tempfile

os.environ["COQUI_TOS_AGREED"] = "1"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

models = {
    "stt": None,
    "tts": None
}

VOICES_DIR = "voice_profiles"
os.makedirs(VOICES_DIR, exist_ok=True)

# Use system temp dir — works correctly in Docker and bare-metal alike
TMP_DIR = tempfile.gettempdir()


def tmp_path(prefix: str, suffix: str = "") -> str:
    """Return a unique temp file path that is guaranteed to be writable."""
    return os.path.join(TMP_DIR, f"{prefix}_{uuid.uuid4().hex}{suffix}")


def convert_to_wav(input_path: str, output_path: str) -> bool:
    """Convert any audio format to 22050 Hz mono WAV using ffmpeg."""
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", input_path,
                "-ar", "22050",
                "-ac", "1",
                "-f", "wav",
                output_path
            ],
            capture_output=True,
            text=True,
            timeout=30
        )
        return result.returncode == 0
    except Exception as e:
        print(f"FFmpeg conversion error: {e}")
        return False


@app.on_event("startup")
async def load_all_models():
    print("--- Initializing AI Suite ---")
    try:
        print("Loading Whisper (STT)...")
        models["stt"] = whisper.load_model("base", device="cpu")

        print("Loading XTTS v2 (TTS/Cloning)...")
        models["tts"] = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cpu")

        print("--- All Models Ready ---")
    except Exception as e:
        print(f"Error during model loading: {str(e)}")


@app.get("/")
async def status():
    return {
        "status": "Online",
        "features": {
            "transcription": "Ready" if models["stt"] else "Loading",
            "voice_cloning": "Ready" if models["tts"] else "Loading"
        }
    }


# --- FEATURE 1: TRANSCRIPTION ---
@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    if not models["stt"]:
        raise HTTPException(status_code=503, detail="Transcription model still loading...")

    raw_path = tmp_path("stt_raw")
    wav_path = tmp_path("stt", ".wav")

    try:
        with open(raw_path, "wb") as b:
            b.write(await file.read())

        if not convert_to_wav(raw_path, wav_path):
            raise HTTPException(
                status_code=400,
                detail="Could not convert audio. Ensure ffmpeg is installed."
            )

        result = models["stt"].transcribe(wav_path)
        return {"text": result["text"]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        for p in [raw_path, wav_path]:
            if os.path.exists(p):
                os.remove(p)


# --- FEATURE 2: SAVE VOICE PROFILE ---
@app.post("/voice-profile/save")
async def save_voice_profile(
    file: UploadFile = File(...),
    profile_id: str = Form(...)
):
    """Save a voice recording as a named profile for later cloning."""
    raw_path = tmp_path("voice_raw")
    wav_path = os.path.join(VOICES_DIR, f"{profile_id}.wav")

    try:
        with open(raw_path, "wb") as b:
            b.write(await file.read())

        if not convert_to_wav(raw_path, wav_path):
            raise HTTPException(status_code=400, detail="Could not convert audio.")

        # Check duration — XTTS needs at least 3 seconds
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                wav_path
            ],
            capture_output=True, text=True
        )
        duration = float(result.stdout.strip()) if result.stdout.strip() else 0

        return {
            "success": True,
            "profile_id": profile_id,
            "duration_seconds": round(duration, 2),
            "message": "Voice profile saved successfully."
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(raw_path):
            os.remove(raw_path)


# --- FEATURE 3: LIST VOICE PROFILES ---
@app.get("/voice-profile/list")
async def list_voice_profiles():
    profiles = []
    for f in os.listdir(VOICES_DIR):
        if f.endswith(".wav"):
            profiles.append({"profile_id": f[:-4], "filename": f})
    return {"profiles": profiles}


# --- FEATURE 4: SYNTHESIZE WITH CLONED VOICE ---
@app.post("/synthesize")
async def synthesize(
    text: str = Form(...),
    profile_id: str = Form(...)
):
    """Generate speech from text using a saved voice profile."""
    if not models["tts"]:
        raise HTTPException(status_code=503, detail="TTS model still loading...")

    ref_wav = os.path.join(VOICES_DIR, f"{profile_id}.wav")
    if not os.path.exists(ref_wav):
        raise HTTPException(
            status_code=404,
            detail=f"Voice profile '{profile_id}' not found."
        )

    out_path = tmp_path("synth", ".wav")

    try:
        models["tts"].tts_to_file(
            text=text,
            speaker_wav=ref_wav,
            language="en",
            file_path=out_path
        )
        return FileResponse(
            out_path,
            media_type="audio/wav",
            headers={"Content-Disposition": "attachment; filename=synthesized.wav"}
        )
    except Exception as e:
        print(f"Synthesis Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {str(e)}")


# --- LEGACY: CLONE-VOICE (one-shot, kept for compatibility) ---
@app.post("/clone-voice")
async def clone(
    text: str = Form(...),
    file: UploadFile = File(...)
):
    if not models["tts"]:
        raise HTTPException(status_code=503, detail="Cloning model still loading...")

    raw_path = tmp_path("ref_raw")
    ref_path = tmp_path("ref", ".wav")
    out_path = tmp_path("clone", ".wav")

    try:
        with open(raw_path, "wb") as b:
            b.write(await file.read())

        if not convert_to_wav(raw_path, ref_path):
            raise HTTPException(
                status_code=400,
                detail="Could not convert reference audio."
            )

        models["tts"].tts_to_file(
            text=text,
            speaker_wav=ref_path,
            language="en",
            file_path=out_path
        )
        return FileResponse(out_path, media_type="audio/wav")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cloning failed: {str(e)}")
    finally:
        for p in [raw_path, ref_path]:
            if os.path.exists(p):
                os.remove(p)