from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import whisper
from TTS.api import TTS
import os
import torch

# This MUST be set before the TTS model is initialized to bypass the 
# interactive license agreement in Docker
os.environ["COQUI_TOS_AGREED"] = "1"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model containers
models = {
    "stt": None,
    "tts": None
}

@app.on_event("startup")
async def load_all_models():
    print("--- Initializing AI Suite ---")
    
    try:
        # Load Whisper (Transcription)
        print("Loading Whisper (STT)...")
        models["stt"] = whisper.load_model("base", device="cpu")
        
        # Load XTTS v2 (Cloning/Synthesis)
        print("Loading XTTS v2 (Cloning)... This may take a while.")
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

    temp_path = f"stt_{file.filename}"
    try:
        with open(temp_path, "wb") as b:
            b.write(await file.read())
        
        result = models["stt"].transcribe(temp_path)
        return {"text": result["text"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

# --- FEATURE 2: VOICE CLONING ---
@app.post("/clone-voice")
async def clone(
    text: str = Form(...), 
    file: UploadFile = File(...)
):
    if not models["tts"]:
        raise HTTPException(status_code=503, detail="Cloning model still loading...")

    ref_path = f"ref_{file.filename}"
    out_path = "cloned_output.wav"
    
    try:
        # 1. Save reference audio
        with open(ref_path, "wb") as b:
            b.write(await file.read())

        # 2. Synthesize new text using the recorded reference voice
        models["tts"].tts_to_file(
            text=text,
            speaker_wav=ref_path,
            language="en",
            file_path=out_path
        )

        return FileResponse(out_path, media_type="audio/wav")
    
    except Exception as e:
        print(f"Synthesis Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Cloning failed: {str(e)}")
    
    finally:
        # Clean up the reference file immediately to save space[cite: 1]
        if os.path.exists(ref_path):
            os.remove(ref_path)