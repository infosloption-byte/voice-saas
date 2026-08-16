from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Header, Request
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
import torch
import types

# ── Compatibility shim ─────────────────────────────────────────────
# torch.xpu (Intel XPU device support) was added in PyTorch 2.4.
# F5-TTS checks it at import time AND at every infer() call on torch 2.2.x.
# We stub the entire sub-module so every attribute access returns False/0
# without raising AttributeError — including _is_in_bad_fork, which F5-TTS
# calls at synthesis time via a multiprocessing fork-safety check.
if not hasattr(torch, "xpu"):
    _xpu_stub = types.ModuleType("torch.xpu")
    _xpu_stub.is_available     = lambda: False
    _xpu_stub.device_count     = lambda: 0
    _xpu_stub._is_in_bad_fork  = lambda: False
    _xpu_stub.current_device   = lambda: 0
    _xpu_stub.get_device_name  = lambda idx=0: ""
    _xpu_stub.device           = lambda idx=0: "cpu"
    _xpu_stub.synchronize      = lambda: None
    _xpu_stub.empty_cache      = lambda: None

    # Catch-all: any other attribute F5-TTS might probe returns a no-op
    def _xpu_getattr(name: str):
        def _noop(*a, **kw):
            return False
        return _noop

    _xpu_stub.__getattr__ = _xpu_getattr
    torch.xpu = _xpu_stub  # type: ignore[attr-defined]

import whisper
from TTS.api import TTS
import os
import re
import subprocess
import uuid
import tempfile
import time
import threading
import asyncio
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import soundfile as sf

os.environ["COQUI_TOS_AGREED"] = "1"

# ── Hardware capability detection ──────────────────────────────────
# F5-TTS inference on CPU is extremely memory-hungry and will OOM-kill the
# worker process — which takes XTTS down with it (the whole process dies and
# every subsequent request, including XTTS, returns 502 until restart).
# We therefore only expose / run F5-TTS when a CUDA GPU is present, unless
# the operator explicitly opts in via F5_ALLOW_CPU=1.
CUDA_AVAILABLE = bool(getattr(torch, "cuda", None) and torch.cuda.is_available())
F5_ALLOW_CPU   = os.getenv("F5_ALLOW_CPU", "0").strip().lower() in ("1", "true", "yes", "on")
# Language code(s) the loaded F5 checkpoint can speak. Default English; set
# F5_LANGUAGES (e.g. "es" or "es,en") when loading a non-English F5 model.
F5_LANGUAGES   = [c.strip().lower() for c in os.getenv("F5_LANGUAGES", "en").split(",") if c.strip()] or ["en"]

# ── Chatterbox (Resemble AI, MIT-licensed) — third TTS engine ──────
# Added alongside XTTS/F5, not replacing either: XTTS v2 is CPML and F5-TTS
# weights are CC-BY-NC — neither is properly licensed for a commercial
# product without separately contacting the respective authors. Chatterbox
# is MIT-licensed, so it's the one engine here genuinely free for commercial
# use out of the box. Unlike F5, Chatterbox's own docs support device="cpu"
# directly (no OOM-kill risk reported), so — unlike F5_ALLOW_CPU — it is not
# gated behind an opt-in flag; it simply runs slower on CPU than on GPU.
CHATTERBOX_ENABLED   = os.getenv("CHATTERBOX_ENABLED", "1").strip().lower() in ("1", "true", "yes", "on")
# Chatterbox Multilingual v3 covers 21 languages + 4 dialects as of the
# June 2026 release. Kept as an env override in case a future Chatterbox
# release changes coverage without needing a code change here.
CHATTERBOX_LANGUAGES = [c.strip().lower() for c in os.getenv(
    "CHATTERBOX_LANGUAGES",
    "en,es,fr,de,it,pt,pl,tr,ru,nl,cs,ar,zh,ja,ko,hi,hu,vi,uk,el,sv,fi,he"
).split(",") if c.strip()]

# ── RVC post-processing (optional) ─────────────────────────────────
# RVC re-maps XTTS/F5 output onto a trained target-speaker model, closing
# the timbre gap zero-shot TTS conditioning alone can't close. IMPORTANT
# CAVEAT (read before enabling in production): unlike XTTS/F5, RVC is NOT
# zero-shot — it needs an actual trained model (a .pth checkpoint, plus an
# optional .index for retrieval) per target voice. A 6-30s reference clip
# is NOT enough on its own; that clip has to first go through an RVC
# training run (typically a few minutes of audio, a GPU, ~10-30 min of
# training via the RVC-WebUI trainer or equivalent) to produce that .pth.
# This module only handles the INFERENCE side: given an already-trained
# model for a profile, apply it to freshly synthesized audio. Producing
# the model itself is a separate, out-of-band step — see
# ai-engine/rvc/README.md for the training workflow this expects.
RVC_ENABLED     = os.getenv("RVC_ENABLED", "0").strip().lower() in ("1", "true", "yes", "on")
RVC_MODELS_DIR  = os.getenv("RVC_MODELS_DIR", os.path.join(os.path.dirname(__file__), "rvc_models"))
RVC_DEVICE      = os.getenv("RVC_DEVICE", "cuda:0" if CUDA_AVAILABLE else "cpu")
# Cap how many RVC models stay loaded in memory at once (~a few hundred MB
# each) — profiles beyond this get lazily reloaded on next use instead of
# accumulating forever.
RVC_MAX_LOADED  = int(os.getenv("RVC_MAX_LOADED", "2"))

try:
    from rvc_python.infer import RVCInference  # optional dependency — see requirements-rvc.txt
    RVC_LIB_AVAILABLE = True
except ImportError:
    RVC_LIB_AVAILABLE = False

models: dict = {"stt": None, "xtts": None, "f5tts": None, "chatterbox": None}
_rvc_instances: "dict[str, object]" = {}   # profile_id -> loaded RVCInference
_rvc_lru: list = []                         # most-recently-used profile_ids, front = newest


def f5_usable() -> bool:
    """F5-TTS is only usable if it loaded AND we can run it without crashing
    the process (GPU present, or operator explicitly allowed CPU)."""
    return models["f5tts"] is not None and (CUDA_AVAILABLE or F5_ALLOW_CPU)


def chatterbox_usable() -> bool:
    """Chatterbox has no CPU OOM-kill risk reported (unlike F5), so
    availability is just: did it load. Runs on GPU when present, CPU
    otherwise — slower on CPU, but not process-crashing."""
    return models["chatterbox"] is not None

VOICES_DIR = "voice_profiles"
os.makedirs(VOICES_DIR, exist_ok=True)

BUILTIN_REFS_DIR = os.getenv("BUILTIN_REFS_DIR", "builtin_refs")
os.makedirs(BUILTIN_REFS_DIR, exist_ok=True)

TMP_DIR = tempfile.gettempdir()

# ── Security ───────────────────────────────────────────────────────
_ENGINE_API_KEY = os.getenv("AI_ENGINE_API_KEY", "")
MAX_UPLOAD_BYTES = 100 * 1024 * 1024   # 100 MB hard ceiling on all uploads

def verify_api_key(x_engine_key: str = Header(default="")) -> None:
    """Reject requests that don't carry the shared engine API key.
    If AI_ENGINE_API_KEY is not set the check is skipped (local dev mode)."""
    if _ENGINE_API_KEY and x_engine_key != _ENGINE_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing engine API key.")

def sanitize_profile_id(raw: str) -> str:
    """Strip path-traversal characters and limit length."""
    safe = re.sub(r'[^\w\-]', '_', raw)   # allow only word chars and hyphens
    return safe[:100]

def parse_builtin_speaker(raw: str) -> tuple[bool, str]:
    """Return (True, speaker_name) when profile_id is a Voxora Library speaker."""
    if raw.startswith("builtin:"):
        return True, raw[len("builtin:"):]
    return False, ""

# Short, natural sentence used to generate each built-in voice's reference clip.
# Long enough for F5 to capture speaker character; short enough to be fast.
_BUILTIN_REF_TEXT = (
    "Welcome to Voxora. I can bring any script to life with a natural, expressive voice."
)

_builtin_ref_lock = threading.Lock()

def get_builtin_ref_wav(speaker_name: str) -> str:
    """Return the path to a reference WAV for the named XTTS built-in speaker.

    On first call for a given speaker, synthesizes a short clip using XTTS and
    caches it under builtin_refs/<safe_name>.wav so F5-TTS can use it as a
    voice reference. Thread-safe; raises RuntimeError if XTTS is not loaded.
    """
    safe = re.sub(r'[^\w\-]', '_', speaker_name)[:80]
    cache_path = os.path.join(BUILTIN_REFS_DIR, f"{safe}.wav")

    if os.path.exists(cache_path) and os.path.getsize(cache_path) > 0:
        return cache_path

    with _builtin_ref_lock:
        # Double-check under lock — another thread may have written it first.
        if os.path.exists(cache_path) and os.path.getsize(cache_path) > 0:
            return cache_path

        xtts = models.get("xtts")
        if xtts is None:
            raise RuntimeError("XTTS v2 is not loaded — cannot generate built-in voice reference.")

        print(f"[builtin_ref] Generating reference clip for '{speaker_name}'…")
        tmp = cache_path + ".tmp"
        try:
            xtts.tts_to_file(
                text=_BUILTIN_REF_TEXT,
                speaker=speaker_name,
                language="en",
                file_path=tmp,
                temperature=0.65,
                top_k=50,
                top_p=0.85,
                speed=1.0,
                enable_text_splitting=False,
            )
            os.replace(tmp, cache_path)  # atomic on POSIX
            print(f"[builtin_ref] Cached → {cache_path}")
        except Exception as e:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise RuntimeError(f"Failed to generate built-in voice reference for '{speaker_name}': {e}") from e

    return cache_path

async def check_file_size(file: UploadFile) -> UploadFile:
    """Reject uploads over MAX_UPLOAD_BYTES to prevent memory exhaustion."""
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Upload too large (100 MB limit).")
    # Rewind so callers can read the bytes normally
    await file.seek(0)
    return file


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


# ── Neural denoise (optional, used only for saved voice-profile refs) ──
# ffmpeg's afftdn (spectral gate) already runs in convert_to_wav(). For
# voice-profile references specifically we additionally try a neural
# denoiser (DeepFilterNet), which removes noise far more surgically without
# smearing the formants that carry speaker identity — noisy reference audio
# is one of the biggest silent killers of cloning similarity. This is fully
# optional: if `deepfilternet` isn't installed, we log once and continue
# with the ffmpeg-only pipeline, so nothing breaks on servers without it.
#   pip install deepfilternet
_DF_MODEL = None
_DF_STATE = None
_DF_LOCK  = threading.Lock()
_DF_UNAVAILABLE = False  # sticky flag so we only try/log once per process


def _try_load_deepfilternet() -> bool:
    global _DF_MODEL, _DF_STATE, _DF_UNAVAILABLE
    if _DF_MODEL is not None:
        return True
    if _DF_UNAVAILABLE:
        return False
    with _DF_LOCK:
        if _DF_MODEL is not None:
            return True
        if _DF_UNAVAILABLE:
            return False
        try:
            from df.enhance import init_df
            _DF_MODEL, _DF_STATE, _ = init_df()
            print("[denoise] DeepFilterNet loaded — neural denoise enabled for voice-profile references.")
            return True
        except Exception as e:
            print(f"[denoise] DeepFilterNet not available ({e}); using ffmpeg spectral denoise only. "
                  f"Run `pip install deepfilternet` to enable neural denoise.")
            _DF_UNAVAILABLE = True
            return False


def neural_denoise(wav_path: str) -> None:
    """In-place neural denoise. Non-fatal no-op if DeepFilterNet isn't installed
    or the pass fails for any reason — the caller's ffmpeg-cleaned file is kept."""
    if not _try_load_deepfilternet():
        return
    try:
        from df.enhance import enhance, load_audio, save_audio
        audio, _ = load_audio(wav_path, sr=_DF_STATE.sr())
        enhanced = enhance(_DF_MODEL, _DF_STATE, audio)
        save_audio(wav_path, enhanced, _DF_STATE.sr())
    except Exception as e:
        print(f"[denoise] Neural denoise pass failed (non-fatal, keeping ffmpeg-only output): {e}")


def convert_to_wav_enhanced(input_path: str, output_path: str, sample_rate: int = 22050) -> bool:
    """convert_to_wav() + an additional neural denoise pass, specifically for
    voice-profile reference clips where noise directly hurts clone similarity.
    Re-normalizes sample rate/format afterward since the denoiser may change
    the sample rate internally."""
    if not convert_to_wav(input_path, output_path, sample_rate=sample_rate):
        return False
    neural_denoise(output_path)
    tmp = output_path + ".renorm.wav"
    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", output_path,
             "-ar", str(sample_rate), "-ac", "1",
             "-f", "wav", "-acodec", "pcm_s16le", tmp],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            os.replace(tmp, output_path)
        elif os.path.exists(tmp):
            os.remove(tmp)
    except Exception as e:
        print(f"[denoise] Re-normalize after denoise failed (non-fatal): {e}")
        if os.path.exists(tmp):
            os.remove(tmp)
    return True


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
def synthesize_chunk_f5(
    chunk: str, ref_wav: str, speed: float, chunk_path: str,
    cfg_strength: float = 2.0, target_rms: float = 0.1,
    sway_sampling_coef: float = -1.0, ref_text: str = "",
) -> None:
    """
    Synthesize a single text chunk using F5-TTS and save to chunk_path.
    Handles multiple F5-TTS API versions gracefully.

    cfg_strength / target_rms / sway_sampling_coef are F5's own inference
    knobs and are how we express "tone" on F5 (it has no temperature/top_k
    like XTTS). Higher cfg_strength = more emphatic adherence; target_rms
    controls loudness; sway_sampling_coef nearer 0 = more pitch variation.

    ref_text: pass the pre-computed Whisper transcription of ref_wav when
    available (see get_cached_ref_text). Leaving it "" makes F5 auto-
    transcribe the reference on every single call — slower, and a bad
    auto-transcription measurably hurts how close the cloned voice lands
    to the original speaker.
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
            ref_text=ref_text,    # cached transcription, or "" to auto-transcribe
            gen_text=chunk,
            speed=max(0.5, min(2.0, speed)),
            target_rms=target_rms,
            cross_fade_duration=0.15,
            cfg_strength=cfg_strength,
            sway_sampling_coef=sway_sampling_coef,
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
                ref_text=ref_text,
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


def synthesize_chunk_chatterbox(
    chunk: str, ref_wav: "str | None", speed: float, chunk_path: str,
    exaggeration: float = 0.5, cfg_weight: float = 0.5, temperature: float = 0.8,
    language_id: str = "en",
) -> None:
    """
    Synthesize a single text chunk using Chatterbox and save to chunk_path.

    exaggeration / cfg_weight / temperature are Chatterbox's own inference
    knobs and are how we express "tone" here (it has no top_k/top_p like
    XTTS, and no target_rms/sway_sampling_coef like F5). Higher exaggeration
    = more expressive delivery (and tends to speed up pacing — lowering
    cfg_weight compensates with slower, more deliberate pacing).

    ref_wav is optional: Chatterbox can generate in its own default voice
    with no reference at all, unlike XTTS (needs speaker= or speaker_wav=)
    and F5 (always needs a reference). We still expect a real profile clip
    in practice, since Voxora's whole point is cloning, not stock voices.

    speed is accepted for interface parity with synthesize_chunk_f5/XTTS
    but Chatterbox has no native speed parameter, and nothing downstream
    currently time-stretches its output — a speed value other than 1.0 is
    silently ignored on this engine today. If per-engine speed control
    matters, add an ffmpeg atempo pass here (or in the caller) rather than
    pretend Chatterbox is honoring the value.
    """
    cb = models["chatterbox"]
    if cb is None:
        raise RuntimeError("Chatterbox model not loaded")

    try:
        kwargs: dict = {
            "exaggeration": max(0.0, min(2.0, exaggeration)),
            "cfg_weight":   max(0.0, min(1.0, cfg_weight)),
            "temperature":  max(0.05, min(2.0, temperature)),
        }
        if ref_wav:
            kwargs["audio_prompt_path"] = ref_wav
        # Multilingual builds accept language_id; the English-only build
        # doesn't take the kwarg at all — try with it first, fall back
        # without on TypeError rather than assuming which build loaded.
        try:
            wav = cb.generate(chunk, language_id=language_id, **kwargs)
        except TypeError:
            wav = cb.generate(chunk, **kwargs)
    except Exception as e:
        raise RuntimeError(f"Chatterbox generate() failed: {e}") from e

    if wav is None:
        raise RuntimeError("Chatterbox returned no audio data")

    sr = getattr(cb, "sr", 24000)

    # ── Normalise to numpy float32 (identical shape to synthesize_chunk_f5) ──
    if hasattr(wav, "cpu"):          # torch tensor
        wav = wav.cpu().numpy()
    wav = np.array(wav, dtype=np.float32)

    if wav.ndim > 1:
        wav = wav.reshape(-1) if wav.shape[0] == 1 else wav[0]

    if wav.size == 0:
        raise RuntimeError("Chatterbox produced empty audio array")

    sf.write(chunk_path, wav, sr, subtype="PCM_16")


# XTTS's tts_to_file(speaker_wav=...) recomputes the speaker's conditioning
# latents (gpt_cond_latent, speaker_embedding) from the reference WAV on
# EVERY call. Two problems with that: (1) it's wasted compute for a saved
# profile that's reused many times, and (2) it only ever sees ONE take of
# the speaker. Computing latents once from ALL of a profile's reference
# clips together — and caching the (averaged) result — gives a noticeably
# closer and more stable timbre match than conditioning from a single clip
# every time.
def _get_raw_xtts_model():
    """Return the underlying TTS.tts.models.xtts.Xtts nn.Module, or None."""
    xtts = models.get("xtts")
    if xtts is None:
        return None
    try:
        return xtts.synthesizer.tts_model
    except Exception:
        return None


def compute_and_cache_xtts_latents(profile_id: str, wav_paths: list[str]) -> bool:
    """Compute XTTS conditioning latents from one or more reference clips and
    cache them to disk as {profile_id}.latents.pt. Returns True on success.
    Non-fatal on failure — callers fall back to passing speaker_wav directly
    on every request, which is slower but still works."""
    model = _get_raw_xtts_model()
    if model is None or not wav_paths:
        return False
    try:
        try:
            # Newer coqui-tts accepts a list of reference clips directly and
            # averages internally — this is the preferred path when available.
            gpt_cond_latent, speaker_embedding = model.get_conditioning_latents(
                audio_path=wav_paths, gpt_cond_len=30, max_ref_length=60,
            )
        except TypeError:
            # Older API only accepts a single path per call — average manually.
            latents, embeds = [], []
            for wp in wav_paths:
                g, s = model.get_conditioning_latents(audio_path=wp, gpt_cond_len=30, max_ref_length=60)
                latents.append(g)
                embeds.append(s)
            gpt_cond_latent = torch.mean(torch.stack(latents), dim=0)
            speaker_embedding = torch.mean(torch.stack(embeds), dim=0)

        cache_path = os.path.join(VOICES_DIR, f"{profile_id}.latents.pt")
        torch.save({"gpt_cond_latent": gpt_cond_latent, "speaker_embedding": speaker_embedding}, cache_path)
        print(f"[latents] Cached averaged XTTS conditioning from {len(wav_paths)} clip(s) → {cache_path}")
        return True
    except Exception as e:
        print(f"[latents] Failed to compute cached latents for '{profile_id}' (non-fatal, "
              f"will condition from speaker_wav per request instead): {e}")
        return False


def load_cached_xtts_latents(profile_id: str):
    """Return (gpt_cond_latent, speaker_embedding) if cached, else None."""
    cache_path = os.path.join(VOICES_DIR, f"{profile_id}.latents.pt")
    if not os.path.exists(cache_path):
        return None
    try:
        data = torch.load(cache_path, map_location="cpu")
        return data["gpt_cond_latent"], data["speaker_embedding"]
    except Exception as e:
        print(f"[latents] Failed to load cached latents for '{profile_id}' (non-fatal): {e}")
        return None


def xtts_synthesize_with_latents(
    text: str, language: str, gpt_cond_latent, speaker_embedding, file_path: str,
    temperature: float, top_k: int, top_p: float, speed: float, repetition_penalty: float,
) -> None:
    """Run XTTS inference directly from pre-computed (possibly multi-clip
    averaged) latents, bypassing tts_to_file's per-call re-encoding of
    speaker_wav. Raises on failure so callers can fall back to speaker_wav."""
    model = _get_raw_xtts_model()
    if model is None:
        raise RuntimeError("XTTS model not loaded")
    out = model.inference(
        text=text, language=language,
        gpt_cond_latent=gpt_cond_latent, speaker_embedding=speaker_embedding,
        temperature=temperature, top_k=top_k, top_p=top_p,
        repetition_penalty=repetition_penalty, speed=speed,
    )
    wav = np.array(out["wav"], dtype=np.float32)
    sf.write(file_path, wav, 24000, subtype="PCM_16")


# ── Reference-text cache (similarity optimization for F5-TTS) ─────
# F5-TTS auto-transcribes the reference clip on every call when ref_text=""
# — that's wasted work AND a source of variance: a bad auto-transcription
# misaligns F5's text/audio conditioning and directly hurts how close the
# output timbre lands to the original speaker. We transcribe once at
# profile-save time (we already have Whisper loaded) and reuse it forever.
def ref_text_cache_path(safe_profile_id: str) -> str:
    return os.path.join(VOICES_DIR, f"{safe_profile_id}.reftext.txt")


def get_cached_ref_text(profile_id: str) -> str:
    """Return the pre-computed transcription of a profile's primary reference
    clip, or '' if none is cached (F5 will fall back to auto-transcribing)."""
    safe = sanitize_profile_id(profile_id)
    p = ref_text_cache_path(safe)
    if os.path.exists(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                return f.read().strip()
        except Exception:
            pass
    return ""


# ── Model loading ──────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app):
    await load_all_models()
    yield


app = FastAPI(lifespan=lifespan)

# ── CORS ───────────────────────────────────────────────────────────
import os as _os
_raw_origins = _os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Accept", "X-Engine-Key"],
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

    # F5-TTS — optional, GPU-only by default.
    # Skip loading entirely on CPU-only servers: loading the model wastes
    # memory and, more importantly, inference would OOM-kill the worker and
    # take XTTS down with it. Set F5_ALLOW_CPU=1 to override on a big box.
    # NOTE: this only skips F5 specifically — Chatterbox loading (below)
    # still runs on CPU-only servers, since Chatterbox's own docs support
    # device="cpu" without the same OOM-kill risk F5 has.
    f5_skip_cpu_only = not (CUDA_AVAILABLE or F5_ALLOW_CPU)
    if f5_skip_cpu_only:
        print("ℹ F5-TTS disabled — no CUDA GPU detected (set F5_ALLOW_CPU=1 to force).")
        print("  XTTS v2 remains fully available.")
    else:
        # F5-TTS — optional, graceful fallback.
        #
        # The default (no args) loads F5's standard English checkpoint. F5 has no
        # language id — each checkpoint speaks the language(s) it was trained on,
        # and reads the input text directly. To run a different-language F5 model:
        #   F5_MODEL       — a model name known to your f5_tts version
        #   F5_CKPT_FILE   — path / hf://repo/file of a custom checkpoint
        #   F5_VOCAB_FILE  — matching vocab.txt (hf:// allowed)
        #   F5_LANGUAGES   — comma-separated codes the checkpoint speaks (e.g. "es"
        #                    or "es,en"); drives which languages the UI offers for F5
        # Example (Spanish):
        #   F5_CKPT_FILE=hf://jpgallegoar/F5-Spanish/model_1250000.safetensors
        #   F5_VOCAB_FILE=hf://jpgallegoar/F5-Spanish/vocab.txt
        #   F5_LANGUAGES=es
        f5_model      = os.getenv("F5_MODEL", "").strip()
        f5_ckpt_file  = os.getenv("F5_CKPT_FILE", "").strip()
        f5_vocab_file = os.getenv("F5_VOCAB_FILE", "").strip()

        # Resolve hf:// references to local files (the F5TTS constructor wants paths).
        def _resolve(ref: str) -> str:
            if ref.startswith("hf://"):
                try:
                    from cached_path import cached_path
                    return str(cached_path(ref))
                except Exception as e:
                    print(f"⚠ Could not resolve {ref} via cached_path: {e}")
            return ref

        f5_kwargs: dict = {}
        if f5_model:
            f5_kwargs["model"] = f5_model
        if f5_ckpt_file:
            f5_kwargs["ckpt_file"] = _resolve(f5_ckpt_file)
        if f5_vocab_file:
            f5_kwargs["vocab_file"] = _resolve(f5_vocab_file)

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
                desc = f"model={f5_model or 'default'}" + (", custom ckpt" if f5_ckpt_file else "")
                print(f"Loading F5-TTS (from {module_name}, {desc})…")
                try:
                    models["f5tts"] = F5TTSClass(**f5_kwargs) if f5_kwargs else F5TTSClass()
                except TypeError as te:
                    # Older f5_tts whose constructor doesn't accept these kwargs —
                    # fall back to the default model rather than failing outright.
                    print(f"⚠ F5-TTS ignored custom model kwargs ({te}); loading default.")
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

    # Chatterbox (Resemble AI) — optional, graceful fallback. Runs on either
    # GPU or CPU (device chosen automatically below), so — unlike F5 — this
    # block is NOT skipped on CPU-only servers.
    if not CHATTERBOX_ENABLED:
        print("ℹ Chatterbox disabled (CHATTERBOX_ENABLED=0)")
    else:
        chatterbox_device = "cuda" if CUDA_AVAILABLE else "cpu"
        try:
            print(f"Loading Chatterbox (Multilingual, device={chatterbox_device})…")
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS
            models["chatterbox"] = ChatterboxMultilingualTTS.from_pretrained(device=chatterbox_device)
            print("✓ Chatterbox ready")
        except ImportError:
            print("ℹ Chatterbox not installed — XTTS v2 / F5-TTS remain available")
            print("  To enable: pip install chatterbox-tts")
        except Exception as e:
            print(f"✗ Chatterbox failed to load: {e}")

    print("--- Model Loading Complete ---")



# ── Status ────────────────────────────────────────────────────────
@app.get("/")
async def status():
    return {
        "status": "Online",
        "features": {
            "transcription":       "Ready" if models["stt"]  else "Unavailable",
            "voice_cloning_xtts":  "Ready" if models["xtts"] else "Unavailable",
            "voice_cloning_f5":    "Ready" if f5_usable()    else "Unavailable",
            "voice_cloning_chatterbox": "Ready" if chatterbox_usable() else "Unavailable",
        },
        "engines": {
            "xtts": models["xtts"] is not None,
            # Report F5 as available only when it can actually run, so the
            # frontend disables the F5 option on CPU-only servers.
            "f5":   f5_usable(),
            # Language code(s) the loaded F5 checkpoint speaks. The frontend
            # offers exactly these in the F5 language picker. Defaults to
            # English; set F5_LANGUAGES alongside a non-English checkpoint.
            "f5_languages": F5_LANGUAGES if f5_usable() else [],
            # Chatterbox — unlike F5, runs fine on CPU, so "usable" here is
            # just "did it load", not gated on GPU presence.
            "chatterbox": chatterbox_usable(),
            "chatterbox_languages": CHATTERBOX_LANGUAGES if chatterbox_usable() else [],
        },
        "rvc": {
            # System-level readiness: operator opted in (RVC_ENABLED=1) AND
            # the optional rvc-python dependency actually imported. Neither
            # of these says anything about a specific voice profile — RVC
            # only ever runs for a profile that also has a trained model on
            # disk (see rvc_model_paths()), which has no self-serve UI yet.
            "enabled":       RVC_ENABLED,
            "lib_installed": RVC_LIB_AVAILABLE,
            "usable":        RVC_ENABLED and RVC_LIB_AVAILABLE,
            "device":        RVC_DEVICE if (RVC_ENABLED and RVC_LIB_AVAILABLE) else None,
        },
        "gpu": CUDA_AVAILABLE,
    }


# ── BUILT-IN VOICES ──────────────────────────────────────────────
@app.get("/built-in-voices")
async def built_in_voices(_key: None = Depends(verify_api_key)):
    """Return the list of XTTS v2 built-in studio speakers."""
    if not models["xtts"]:
        raise HTTPException(503, "XTTS v2 model is not available.")
    try:
        speakers = list(models["xtts"].speakers or [])
    except Exception:
        speakers = []
    return {"speakers": speakers}


@app.get("/voice-preview/{speaker_name}")
async def voice_preview(speaker_name: str):
    """Return a short WAV preview clip for a built-in XTTS speaker.

    No API key required — used by the public marketing voice library.
    The clip is lazily generated on first request and cached on disk.
    """
    if not models["xtts"]:
        raise HTTPException(503, "XTTS v2 model is not available — preview not ready yet.")

    # Decode URL-encoded name and sanity-check it against known speakers
    from urllib.parse import unquote
    decoded = unquote(speaker_name)
    try:
        known: list[str] = list(models["xtts"].speakers or [])
    except Exception:
        known = []
    if known and decoded not in known:
        raise HTTPException(404, f"Unknown speaker: {decoded!r}")

    try:
        wav_path = get_builtin_ref_wav(decoded)
    except RuntimeError as e:
        raise HTTPException(500, str(e))

    return FileResponse(
        wav_path,
        media_type="audio/wav",
        headers={
            "Cache-Control": "public, max-age=86400",
            "Content-Disposition": 'inline; filename="{}.wav"'.format(re.sub(r'\W', '_', decoded)),
        },
    )


# ── TRANSLATION ───────────────────────────────────────────────────
import json as _json
import urllib.request as _urllib_req
import urllib.error as _urllib_err

_GEMINI_KEY = os.getenv("GEMINI_API_KEY", "")

# Gemini models tried in order — if one fails (quota/rate-limit/error),
# the next is attempted automatically.
GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-3-flash",
    "gemini-2.5-flash-lite",
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
]

LANG_NAMES: dict[str, str] = {
    "en": "English", "es": "Spanish", "fr": "French", "de": "German",
    "it": "Italian", "pt": "Portuguese", "pl": "Polish", "tr": "Turkish",
    "ru": "Russian", "nl": "Dutch", "cs": "Czech", "ar": "Arabic",
    "zh": "Chinese", "ja": "Japanese", "ko": "Korean", "hi": "Hindi",
    "hu": "Hungarian",
}

_TRANSLATE_SYSTEM = (
    "You are a professional translator. Translate the provided text accurately "
    "and naturally. Preserve all formatting, line breaks, speaker labels (e.g. "
    "[Speaker A]:), and punctuation exactly as they appear. Output only the "
    "translated text — no explanations, no quotes around the result."
)

class TranslateRequest(BaseModel):
    text: str
    source_lang: str = "en"
    target_lang: str = "es"

def _http_post_json(url: str, payload: dict, headers: dict) -> dict:
    """POST JSON and return parsed response. On HTTP error, raise with the
    real API error body included so failures are debuggable."""
    data = _json.dumps(payload).encode()
    req = _urllib_req.Request(url, data=data, headers={"Content-Type": "application/json", **headers}, method="POST")
    try:
        with _urllib_req.urlopen(req, timeout=60) as resp:
            return _json.loads(resp.read())
    except _urllib_err.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", "replace")[:500]
        except Exception:
            pass
        raise RuntimeError(f"HTTP {e.code}: {body or e.reason}") from None

def _translate_gemini(model: str, user_msg: str, api_key: str) -> str:
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={api_key}"
    )
    data = _http_post_json(
        url,
        {
            "system_instruction": {"parts": [{"text": _TRANSLATE_SYSTEM}]},
            "contents": [{"parts": [{"text": user_msg}]}],
        },
        {},
    )
    return data["candidates"][0]["content"]["parts"][0]["text"].strip()

@app.post("/translate")
async def translate_text(
    body: TranslateRequest,
    request: Request,
    _key: None = Depends(verify_api_key),
):
    # Key supplied per-request by the backend (admin-panel managed,
    # encrypted at rest in its DB); env var is the fallback.
    gemini_key = request.headers.get("x-gemini-key") or _GEMINI_KEY
    if not gemini_key:
        raise HTTPException(503, "Translation is not configured (set the Gemini key in the admin panel).")
    if not body.text.strip():
        return {"translated_text": ""}

    src = LANG_NAMES.get(body.source_lang, body.source_lang)
    tgt = LANG_NAMES.get(body.target_lang, body.target_lang)
    user_msg = f"Translate the following text from {src} to {tgt}:\n\n{body.text}"

    errors: list[str] = []
    for model in GEMINI_MODELS:
        try:
            return {"translated_text": _translate_gemini(model, user_msg, gemini_key), "provider": model}
        except Exception as e:
            errors.append(f"{model}: {e}")

    raise HTTPException(500, f"All Gemini models failed: {'; '.join(errors)}")


# ── FEATURE 1: TRANSCRIPTION ──────────────────────────────────────
@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    _key: None = Depends(verify_api_key),
):
    if not models["stt"]:
        raise HTTPException(503, "Transcription model still loading…")

    await check_file_size(file)
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
MAX_PROFILE_CLIPS = 4

@app.post("/voice-profile/save")
async def save_voice_profile(
    file: list[UploadFile] = File(...),
    profile_id: str = Form(...),
    _key: None = Depends(verify_api_key),
):
    """Save a voice profile from one or more reference clips.

    NOTE: the form field is named "file" (not "files") on purpose — the
    Laravel backend uploads a single clip under a field named "file"
    (Http::attach('file', ...)). FastAPI/Starlette binds repeated fields of
    the same name to a List[UploadFile], so a single "file" upload still
    arrives here as a one-item list — fully backward compatible. To use the
    multi-clip similarity improvement, the caller sends the SAME field name
    "file" multiple times (Laravel: call ->attach('file', ...) once per clip).

    Uploading 2-4 short clips (instead of just one) is the single biggest
    lever for cloning similarity: XTTS conditioning latents get computed
    from ALL clips together and cached as an average, which is a closer and
    more stable timbre match than deriving everything from one take. The
    cleanest clip also gets pre-transcribed with Whisper and cached so
    F5-TTS doesn't have to auto-transcribe (and risk mis-transcribing) the
    reference on every single synthesis call.
    """
    files = file
    if not files:
        raise HTTPException(400, "At least one reference clip is required.")
    if len(files) > MAX_PROFILE_CLIPS:
        raise HTTPException(400, f"Maximum {MAX_PROFILE_CLIPS} reference clips per profile.")
    for f in files:
        await check_file_size(f)

    safe_id = sanitize_profile_id(profile_id)
    raw_paths: list[str] = []
    wav_paths: list[str] = []

    try:
        multi = len(files) > 1
        for i, f in enumerate(files):
            raw_p = tmp_path(f"voice_raw_{i}")
            with open(raw_p, "wb") as b:
                b.write(await f.read())
            raw_paths.append(raw_p)

            wav_p = (os.path.join(VOICES_DIR, f"{safe_id}__{i}.wav") if multi
                     else os.path.join(VOICES_DIR, f"{safe_id}.wav"))
            if not convert_to_wav_enhanced(raw_p, wav_p, sample_rate=22050):
                raise HTTPException(400, f"Could not convert reference clip {i + 1}.")
            trim_silence(wav_p, top_db=35)
            wav_paths.append(wav_p)

        # Primary clip (index 0) is always also available at {safe_id}.wav —
        # this is what F5, the preview endpoint, and older clients expect.
        primary_path = os.path.join(VOICES_DIR, f"{safe_id}.wav")
        if primary_path not in wav_paths:
            import shutil
            shutil.copy(wav_paths[0], primary_path)

        durations = []
        for wp in wav_paths:
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", wp],
                capture_output=True, text=True,
            )
            durations.append(float(probe.stdout.strip()) if probe.stdout.strip() else 0)
        total_duration = sum(durations)

        warning = None
        if total_duration < 6:
            warning = (f"Total reference audio is only {total_duration:.1f}s — aim for "
                       f"10-30s across your clip(s) for best cloning quality.")
        elif not multi and durations[0] > 30:
            warning = ("Recording is over 30s — consider trimming to the best 10-20s, "
                       "or upload it as 2-3 separate shorter clips instead (improves similarity).")

        # Pre-transcribe the primary clip once so F5-TTS reuses it instead of
        # auto-transcribing (and risking a bad transcription) on every call.
        if models["stt"] is not None:
            try:
                result = models["stt"].transcribe(primary_path)
                with open(ref_text_cache_path(safe_id), "w", encoding="utf-8") as tf:
                    tf.write(result["text"].strip())
            except Exception as e:
                print(f"[voice-profile] Reference transcription failed (non-fatal): {e}")

        # Precompute averaged XTTS conditioning latents from ALL clips.
        latents_cached = compute_and_cache_xtts_latents(safe_id, wav_paths)

        return {
            "success": True,
            "profile_id": safe_id,
            "clips_saved": len(wav_paths),
            # Kept as "duration_seconds" (not renamed) — the Laravel backend
            # reads $engineData['duration_seconds'] to populate the DB.
            "duration_seconds": round(total_duration, 2),
            "warning": warning,
            "xtts_latents_cached": latents_cached,
            "message": "Voice profile saved successfully.",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        for p in raw_paths:
            if os.path.exists(p):
                os.remove(p)


# ── FEATURE 3: LIST VOICE PROFILES ───────────────────────────────
@app.get("/voice-profile/list")
async def list_voice_profiles(_key: None = Depends(verify_api_key)):
    profiles = []
    for f in os.listdir(VOICES_DIR):
        # Extra multi-clip reference files are named {id}__0.wav, {id}__1.wav,
        # etc. — skip them so each profile appears exactly once in the list.
        if f.endswith(".wav") and "__" not in f:
            safe_id = f[:-4]
            profiles.append({
                "profile_id": safe_id,
                "filename": f,
                "extra_clips": len([
                    x for x in os.listdir(VOICES_DIR) if x.startswith(f"{safe_id}__")
                ]),
                "xtts_latents_cached": os.path.exists(os.path.join(VOICES_DIR, f"{safe_id}.latents.pt")),
            })
    return {"profiles": profiles}


# ── FEATURE 3b: DELETE VOICE PROFILE ─────────────────────────────
@app.get("/voice-profile/{profile_id}/preview")
async def preview_voice_profile(
    profile_id: str,
    _key: None = Depends(verify_api_key),
):
    """Stream the reference WAV for a user's cloned voice profile."""
    safe_id  = sanitize_profile_id(profile_id)
    wav_path = os.path.join(VOICES_DIR, f"{safe_id}.wav")
    if not os.path.exists(wav_path):
        raise HTTPException(404, f"Voice profile '{safe_id}' not found.")
    return FileResponse(
        wav_path,
        media_type="audio/wav",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@app.delete("/voice-profile/{profile_id}")
async def delete_voice_profile(
    profile_id: str,
    _key: None = Depends(verify_api_key),
):
    safe_id = sanitize_profile_id(profile_id)
    removed = 0
    # Primary clip, any extra multi-clip files (__0, __1, ...), cached
    # averaged XTTS latents, and cached F5 reference transcription.
    candidates = [
        os.path.join(VOICES_DIR, f"{safe_id}.wav"),
        os.path.join(VOICES_DIR, f"{safe_id}.latents.pt"),
        ref_text_cache_path(safe_id),
    ] + [os.path.join(VOICES_DIR, f) for f in os.listdir(VOICES_DIR) if f.startswith(f"{safe_id}__")]
    for p in candidates:
        if os.path.exists(p):
            os.remove(p)
            removed += 1
    return {"success": True, "profile_id": safe_id, "files_removed": removed}


# ── Multi-voice helpers ────────────────────────────────────────────
def parse_speaker_segments(text: str) -> list[tuple[str, str]]:
    """
    Split text on [SPEAKER:name] markers.
    Returns list of (speaker_label, text_segment) tuples.
    Segments before the first marker use speaker label "".
    """
    pattern = re.compile(r'\[SPEAKER:([^\]]+)\]', re.IGNORECASE)
    segments: list[tuple[str, str]] = []
    last_end = 0
    current_speaker = ""

    for m in pattern.finditer(text):
        before = text[last_end:m.start()].strip()
        if before:
            segments.append((current_speaker, before))
        current_speaker = m.group(1).strip()
        last_end = m.end()

    tail = text[last_end:].strip()
    if tail:
        segments.append((current_speaker, tail))

    return segments


# ── RVC post-processing helpers ────────────────────────────────────
def rvc_model_paths(profile_id: str | None) -> "tuple[str, str | None] | None":
    """Return (pth_path, index_path_or_None) for a profile's TRAINED RVC
    model, or None if it doesn't have one. Expected layout:
        {RVC_MODELS_DIR}/{profile_id}/model.pth
        {RVC_MODELS_DIR}/{profile_id}/model.index   (optional, improves timbre match)
    A profile with no trained model here simply skips RVC — this is what
    makes the feature safe to enable without breaking every existing
    profile that was only ever recorded, never trained.
    """
    if not profile_id:
        return None
    model_dir = os.path.join(RVC_MODELS_DIR, profile_id)
    pth_path = os.path.join(model_dir, "model.pth")
    if not os.path.exists(pth_path):
        return None
    index_path = os.path.join(model_dir, "model.index")
    return pth_path, (index_path if os.path.exists(index_path) else None)


def _get_rvc_instance(profile_id: str, pth_path: str, index_path: str | None):
    """Lazily load (and LRU-cache up to RVC_MAX_LOADED) an RVCInference for
    this profile. Reloading a .pth on every synthesis call would add
    seconds of latency per request, so loaded models are kept warm."""
    global _rvc_instances, _rvc_lru

    if profile_id in _rvc_instances:
        _rvc_lru.remove(profile_id)
        _rvc_lru.insert(0, profile_id)
        return _rvc_instances[profile_id]

    if len(_rvc_instances) >= RVC_MAX_LOADED:
        oldest = _rvc_lru.pop()
        _rvc_instances.pop(oldest, None)

    rvc = RVCInference(device=RVC_DEVICE)
    rvc.load_model(pth_path)
    if index_path and hasattr(rvc, "set_params"):
        try:
            rvc.set_params(index_path=index_path)
        except Exception as e:
            print(f"[rvc] Could not set index for '{profile_id}' (continuing without it): {e}")

    _rvc_instances[profile_id] = rvc
    _rvc_lru.insert(0, profile_id)
    return rvc


def apply_rvc_conversion(wav_path: str, profile_id: str | None) -> str:
    """Run the RVC post-processing pass on a freshly synthesized WAV.

    Returns the path to the converted audio, or the ORIGINAL wav_path
    unchanged if RVC is disabled, the library isn't installed, the profile
    has no trained model, or conversion fails for any reason — RVC is a
    quality enhancement, never a hard dependency for synthesis to succeed.
    """
    if not RVC_ENABLED or not RVC_LIB_AVAILABLE:
        return wav_path

    resolved = rvc_model_paths(profile_id)
    if resolved is None:
        return wav_path

    pth_path, index_path = resolved
    try:
        rvc = _get_rvc_instance(profile_id, pth_path, index_path)
        converted_path = tmp_path("rvc_out", ".wav")
        rvc.infer_file(wav_path, converted_path)
        if os.path.exists(converted_path) and os.path.getsize(converted_path) > 0:
            return converted_path
        print(f"[rvc] Conversion produced no output for '{profile_id}', keeping original audio.")
        return wav_path
    except Exception as e:
        print(f"[rvc] Conversion failed for '{profile_id}' (non-fatal, keeping original audio): {e}")
        return wav_path


def synthesize_segment(text: str, engine: str,
                        language: str, temperature: float,
                        top_k: int, top_p: float,
                        speed: float, gap_ms: int,
                        repetition_penalty: float = 5.0,
                        ref_wav: str | None = None,
                        speaker_name: str | None = None,
                        profile_id: str | None = None,
                        cfg_strength: float = 2.0,
                        target_rms: float = 0.1,
                        sway_sampling_coef: float = -1.0) -> list[str]:
    """Synthesize one segment (may span multiple chunks). Returns list of chunk paths.

    Provide either ref_wav (custom clone) or speaker_name (XTTS built-in).
    profile_id, when set, is the saved profile's safe id — used to look up
    cached XTTS conditioning latents and F5's pre-computed reference text
    for closer/faster cloning than re-deriving both from ref_wav every call.
    """
    chunks = split_into_chunks(text)
    chunk_paths: list[str] = []

    cached_latents = load_cached_xtts_latents(profile_id) if (engine == "xtts" and profile_id) else None
    ref_text = get_cached_ref_text(profile_id) if (engine == "f5" and profile_id) else ""

    for i, chunk in enumerate(chunks):
        chunk_path = tmp_path(f"seg_chunk_{i}", ".wav")
        chunk_paths.append(chunk_path)
        if engine == "f5":
            # If a custom ref WAV was supplied, use it directly.
            # If this is a built-in XTTS speaker, lazily generate (and cache) a
            # reference clip using XTTS so F5 can clone that voice character.
            f5_ref = ref_wav
            if f5_ref is None:
                if speaker_name:
                    f5_ref = get_builtin_ref_wav(speaker_name)
                else:
                    raise HTTPException(400, "F5-TTS requires a voice reference (custom profile or built-in speaker).")
            synthesize_chunk_f5(chunk=chunk, ref_wav=f5_ref, speed=speed, chunk_path=chunk_path,
                                cfg_strength=cfg_strength, target_rms=target_rms,
                                sway_sampling_coef=sway_sampling_coef, ref_text=ref_text)
        elif engine == "chatterbox":
            # Same "resolve a reference WAV even for a built-in speaker" pattern as F5.
            cb_ref = ref_wav
            if cb_ref is None and speaker_name:
                cb_ref = get_builtin_ref_wav(speaker_name)
            synthesize_chunk_chatterbox(chunk=chunk, ref_wav=cb_ref, speed=speed, chunk_path=chunk_path,
                                        language_id=(language or "en"))
        else:
            if speaker_name:
                models["xtts"].tts_to_file(
                    text=chunk, language=language, file_path=chunk_path,
                    temperature=max(0.1, min(1.0, temperature)),
                    top_k=max(1, min(100, top_k)),
                    top_p=max(0.1, min(1.0, top_p)),
                    speed=max(0.5, min(2.0, speed)),
                    repetition_penalty=max(1.0, min(10.0, repetition_penalty)),
                    enable_text_splitting=False,
                    speaker=speaker_name,
                )
            elif cached_latents is not None:
                gpt_cond_latent, speaker_embedding = cached_latents
                try:
                    xtts_synthesize_with_latents(
                        text=chunk, language=language,
                        gpt_cond_latent=gpt_cond_latent, speaker_embedding=speaker_embedding,
                        file_path=chunk_path,
                        temperature=max(0.1, min(1.0, temperature)),
                        top_k=max(1, min(100, top_k)),
                        top_p=max(0.1, min(1.0, top_p)),
                        speed=max(0.5, min(2.0, speed)),
                        repetition_penalty=max(1.0, min(10.0, repetition_penalty)),
                    )
                except Exception as e:
                    print(f"[latents] Inference from cached latents failed, falling back to speaker_wav: {e}")
                    models["xtts"].tts_to_file(
                        text=chunk, language=language, file_path=chunk_path,
                        temperature=max(0.1, min(1.0, temperature)),
                        top_k=max(1, min(100, top_k)),
                        top_p=max(0.1, min(1.0, top_p)),
                        speed=max(0.5, min(2.0, speed)),
                        repetition_penalty=max(1.0, min(10.0, repetition_penalty)),
                        enable_text_splitting=False,
                        speaker_wav=ref_wav,
                    )
            else:
                models["xtts"].tts_to_file(
                    text=chunk, language=language, file_path=chunk_path,
                    temperature=max(0.1, min(1.0, temperature)),
                    top_k=max(1, min(100, top_k)),
                    top_p=max(0.1, min(1.0, top_p)),
                    speed=max(0.5, min(2.0, speed)),
                    repetition_penalty=max(1.0, min(10.0, repetition_penalty)),
                    enable_text_splitting=False,
                    speaker_wav=ref_wav,
                )
    return chunk_paths


# ── FEATURE 4: SYNTHESIZE (XTTS v2 or F5-TTS, single- or multi-voice) ──
# ── SYNTHESIS JOB QUEUE ───────────────────────────────────────────
# Heavy TTS work runs in a bounded background thread pool rather than
# blocking the HTTP worker for the full (potentially minutes-long)
# synthesis. Clients submit a job, poll /synthesize/status/{id}, then
# download from /synthesize/result/{id}. SYNTH_WORKERS defaults to 1 so
# synthesis stays serialized on CPU-only hosts — this prevents two heavy
# (especially F5) runs from racing and OOM-killing the worker. On a GPU
# host it can safely be raised.
SYNTH_WORKERS    = max(1, int(os.getenv("SYNTH_WORKERS", "1")))
JOB_TTL_SECONDS  = int(os.getenv("SYNTH_JOB_TTL", "1800"))   # 30 min
_synth_executor  = ThreadPoolExecutor(max_workers=SYNTH_WORKERS)
_synth_jobs: dict[str, dict] = {}
_synth_jobs_lock = threading.Lock()


def _cleanup_synth_jobs() -> None:
    """Drop finished/abandoned jobs older than the TTL and delete their WAVs.

    To avoid deleting a file while synthesize_result() is streaming it, we
    only clean up jobs that are NOT currently in 'downloading' status. The
    result endpoint marks jobs 'downloading' before returning the FileResponse
    and resets to 'done' once the file has been handed off to the ASGI layer.
    """
    now = time.time()
    paths_to_delete = []
    with _synth_jobs_lock:
        stale = [
            jid for jid, j in _synth_jobs.items()
            if now - j["created_at"] > JOB_TTL_SECONDS
            and j.get("status") != "downloading"
        ]
        for jid in stale:
            job = _synth_jobs.pop(jid)
            p = job.get("result_path")
            if p:
                paths_to_delete.append(p)

    # Delete files outside the lock so we don't stall other threads.
    for p in paths_to_delete:
        if os.path.exists(p):
            try:
                os.remove(p)
            except OSError:
                pass


def _run_synth_job(job_id: str, params: dict) -> None:
    """Background worker: run synthesis and stash the outcome on the job record."""
    with _synth_jobs_lock:
        if job_id in _synth_jobs:
            _synth_jobs[job_id]["status"] = "processing"
    try:
        out_path = _perform_synthesis(**params)
        with _synth_jobs_lock:
            if job_id in _synth_jobs:
                _synth_jobs[job_id].update(status="done", result_path=out_path)
    except HTTPException as e:
        with _synth_jobs_lock:
            if job_id in _synth_jobs:
                _synth_jobs[job_id].update(status="error", error=str(e.detail), code=e.status_code)
    except Exception as e:
        with _synth_jobs_lock:
            if job_id in _synth_jobs:
                _synth_jobs[job_id].update(status="error", error=str(e), code=500)


def _perform_synthesis(
    text: str, profile_id: str, language: str, tts_engine: str,
    temperature: float, top_k: int, top_p: float, speed: float,
    repetition_penalty: float, gap_ms: int, speaker_map: str,
    cfg_strength: float = 2.0, target_rms: float = 0.1,
    sway_sampling_coef: float = -1.0,
) -> str:
    """Run synthesis end to end and return the path to the finished WAV.

    Raises HTTPException on validation / availability / processing errors.
    This is the shared core used by both the legacy synchronous /synthesize
    endpoint and the background job queue.
    """
    import json as _json
    import shutil

    if len(text) > 50_000:
        raise HTTPException(400, "Text exceeds 50 000 character limit.")

    # Detect and extract built-in speaker BEFORE sanitization (sanitizer would mangle the name)
    is_builtin_voice, builtin_speaker = parse_builtin_speaker(profile_id)
    if not is_builtin_voice:
        profile_id = sanitize_profile_id(profile_id)
    engine = tts_engine.lower().strip()
    if engine not in ("xtts", "f5", "chatterbox"):
        engine = "xtts"

    if engine == "f5" and not f5_usable():
        # Refuse BEFORE running inference. On a CPU-only server F5 would
        # OOM-kill the worker and take XTTS down with it — returning a clean
        # 503 here keeps XTTS healthy.
        if models["f5tts"] is None and not (CUDA_AVAILABLE or F5_ALLOW_CPU):
            detail = ("F5-TTS requires a GPU server and is disabled on this CPU-only "
                      "instance. Please switch to XTTS v2 — it produces great results here.")
        else:
            detail = ("F5-TTS is not available on this server. "
                      "Please switch to XTTS v2 in the engine selector.")
        raise HTTPException(503, detail)
    if engine == "chatterbox" and not chatterbox_usable():
        raise HTTPException(503,
            "Chatterbox is not available on this server. Please switch to XTTS v2 or F5-TTS in the engine selector.")
    if engine == "xtts" and not models["xtts"]:
        raise HTTPException(503, "XTTS v2 model is not available.")

    # Parse speaker_map if provided
    spk_map: dict[str, str] = {}
    if speaker_map.strip():
        try:
            spk_map = _json.loads(speaker_map)
        except Exception:
            pass  # malformed — fall back to single-voice

    # Detect multi-voice: text contains [SPEAKER:...] AND we have a map
    segments = parse_speaker_segments(text.strip())
    is_multi = bool(spk_map) and any(spk for spk, _ in segments)

    all_chunk_paths: list[str] = []
    out_path = tmp_path("synth_final", ".wav")

    try:
        def resolve_voice(pid_raw: str) -> tuple[str | None, str | None, str | None]:
            """Return (ref_wav_path_or_None, builtin_speaker_name_or_None, safe_profile_id_or_None).
            safe_profile_id is only set for a resolved custom profile — used
            to look up cached XTTS latents / F5 ref text for that segment."""
            is_b, spk = parse_builtin_speaker(pid_raw)
            if is_b:
                return None, spk, None
            safe = sanitize_profile_id(pid_raw)
            path = os.path.join(VOICES_DIR, f"{safe}.wav")
            if os.path.exists(path):
                return path, None, safe
            return None, None, None

        if is_multi:
            # ── Multi-voice path ─────────────────────────────────
            seg_wavs: list[str] = []
            for spk_label, seg_text in segments:
                if not seg_text.strip():
                    continue
                raw_pid = spk_map.get(spk_label, profile_id if not is_builtin_voice else f"builtin:{builtin_speaker}")
                seg_ref_wav, seg_speaker, seg_profile_id = resolve_voice(raw_pid)
                # Fall back to default voice if mapped profile missing
                if seg_ref_wav is None and seg_speaker is None:
                    seg_ref_wav = None if is_builtin_voice else os.path.join(VOICES_DIR, f"{profile_id}.wav")
                    seg_speaker = builtin_speaker if is_builtin_voice else None
                    seg_profile_id = None if is_builtin_voice else profile_id
                if seg_ref_wav is None and seg_speaker is None:
                    raise HTTPException(404, f"Voice profile '{raw_pid}' not found.")

                seg_chunks = synthesize_segment(
                    text=seg_text, engine=engine,
                    language=language, temperature=temperature,
                    top_k=top_k, top_p=top_p, speed=speed, gap_ms=gap_ms,
                    repetition_penalty=repetition_penalty,
                    ref_wav=seg_ref_wav, speaker_name=seg_speaker,
                    profile_id=seg_profile_id,
                    cfg_strength=cfg_strength, target_rms=target_rms,
                    sway_sampling_coef=sway_sampling_coef,
                )
                all_chunk_paths.extend(seg_chunks)

                # Merge this segment's chunks into one wav
                seg_merged = tmp_path("seg_merged", ".wav")
                all_chunk_paths.append(seg_merged)
                if len(seg_chunks) == 1:
                    shutil.copy(seg_chunks[0], seg_merged)
                else:
                    if not concatenate_wavs(seg_chunks, seg_merged, gap_ms=gap_ms):
                        raise HTTPException(500, "Failed to merge segment chunks.")

                # RVC pass, per speaker — each segment gets remapped onto
                # its OWN speaker's trained model (if one exists), not a
                # single model for the whole multi-voice output. Falls
                # through to seg_merged unchanged if RVC isn't applicable.
                seg_out = apply_rvc_conversion(seg_merged, seg_profile_id)
                seg_wavs.append(seg_out)

            # Concatenate all segments (longer pause between speakers)
            if len(seg_wavs) == 1:
                shutil.copy(seg_wavs[0], out_path)
            else:
                if not concatenate_wavs(seg_wavs, out_path, gap_ms=max(gap_ms, 200)):
                    raise HTTPException(500, "Failed to merge speaker segments.")
            all_chunk_paths.extend(seg_wavs)

        else:
            # ── Single-voice path ─────────────────────────────────
            if is_builtin_voice:
                if engine in ("f5", "chatterbox"):
                    # F5 and Chatterbox both need an actual WAV — lazily generate & cache from XTTS.
                    ref_wav_path: str | None = get_builtin_ref_wav(builtin_speaker)
                else:
                    ref_wav_path = None   # XTTS uses speaker= kwarg instead
            else:
                ref_wav_path = os.path.join(VOICES_DIR, f"{profile_id}.wav")
                if not os.path.exists(ref_wav_path):
                    raise HTTPException(404, f"Voice profile '{profile_id}' not found.")

            chunks = split_into_chunks(text.strip())
            if not chunks:
                raise HTTPException(400, "No text to synthesise.")

            # Cached optimizations for a saved custom profile (not builtin):
            # averaged XTTS conditioning latents, and F5's pre-transcribed
            # reference text — both computed once at profile-save time.
            cached_latents = (load_cached_xtts_latents(profile_id)
                               if (engine == "xtts" and not is_builtin_voice) else None)
            f5_ref_text = (get_cached_ref_text(profile_id)
                           if (engine == "f5" and not is_builtin_voice) else "")

            for i, chunk in enumerate(chunks):
                chunk_path = tmp_path(f"synth_chunk_{i}", ".wav")
                all_chunk_paths.append(chunk_path)

                if engine == "f5":
                    synthesize_chunk_f5(chunk=chunk, ref_wav=ref_wav_path, speed=speed, chunk_path=chunk_path,
                                        cfg_strength=cfg_strength, target_rms=target_rms,
                                        sway_sampling_coef=sway_sampling_coef, ref_text=f5_ref_text)
                elif engine == "chatterbox":
                    synthesize_chunk_chatterbox(chunk=chunk, ref_wav=ref_wav_path, speed=speed, chunk_path=chunk_path,
                                                language_id=(language or "en"))
                elif is_builtin_voice:
                    models["xtts"].tts_to_file(
                        text=chunk, language=language, file_path=chunk_path,
                        temperature=max(0.1, min(1.0, temperature)),
                        top_k=max(1, min(100, top_k)),
                        top_p=max(0.1, min(1.0, top_p)),
                        speed=max(0.5, min(2.0, speed)),
                        repetition_penalty=max(1.0, min(10.0, repetition_penalty)),
                        enable_text_splitting=False,
                        speaker=builtin_speaker,
                    )
                elif cached_latents is not None:
                    gpt_cond_latent, speaker_embedding = cached_latents
                    try:
                        xtts_synthesize_with_latents(
                            text=chunk, language=language,
                            gpt_cond_latent=gpt_cond_latent, speaker_embedding=speaker_embedding,
                            file_path=chunk_path,
                            temperature=max(0.1, min(1.0, temperature)),
                            top_k=max(1, min(100, top_k)),
                            top_p=max(0.1, min(1.0, top_p)),
                            speed=max(0.5, min(2.0, speed)),
                            repetition_penalty=max(1.0, min(10.0, repetition_penalty)),
                        )
                    except Exception as e:
                        print(f"[latents] Inference from cached latents failed, falling back to speaker_wav: {e}")
                        models["xtts"].tts_to_file(
                            text=chunk, language=language, file_path=chunk_path,
                            temperature=max(0.1, min(1.0, temperature)),
                            top_k=max(1, min(100, top_k)),
                            top_p=max(0.1, min(1.0, top_p)),
                            speed=max(0.5, min(2.0, speed)),
                            repetition_penalty=max(1.0, min(10.0, repetition_penalty)),
                            enable_text_splitting=False,
                            speaker_wav=ref_wav_path,
                        )
                else:
                    models["xtts"].tts_to_file(
                        text=chunk, language=language, file_path=chunk_path,
                        temperature=max(0.1, min(1.0, temperature)),
                        top_k=max(1, min(100, top_k)),
                        top_p=max(0.1, min(1.0, top_p)),
                        speed=max(0.5, min(2.0, speed)),
                        repetition_penalty=max(1.0, min(10.0, repetition_penalty)),
                        enable_text_splitting=False,
                        speaker_wav=ref_wav_path,
                    )

            if len(all_chunk_paths) == 1:
                shutil.copy(all_chunk_paths[0], out_path)
            else:
                if not concatenate_wavs(all_chunk_paths, out_path, gap_ms=gap_ms):
                    raise HTTPException(500, "Failed to merge audio chunks.")

            # RVC pass on the finished single-voice output. Skipped for
            # builtin XTTS speakers (no reference clip / trained model to
            # target) and silently a no-op if this profile has no trained
            # RVC model yet.
            rvc_pid = None if is_builtin_voice else profile_id
            converted = apply_rvc_conversion(out_path, rvc_pid)
            if converted != out_path:
                all_chunk_paths.append(out_path)  # original now superseded — clean it up too
                out_path = converted

        return out_path
    except HTTPException:
        raise
    except Exception as e:
        print(f"Synthesis error [{engine}]: {e}")
        raise HTTPException(500, f"Synthesis failed ({engine}): {e}")
    finally:
        for p in all_chunk_paths:
            if os.path.exists(p):
                os.remove(p)


# ── Synthesis HTTP endpoints ──────────────────────────────────────
def _synth_params(
    text: str, profile_id: str, language: str, tts_engine: str,
    temperature: float, top_k: int, top_p: float, speed: float,
    repetition_penalty: float, gap_ms: int, speaker_map: str,
    cfg_strength: float = 2.0, target_rms: float = 0.1,
    sway_sampling_coef: float = -1.0,
) -> dict:
    return dict(
        text=text, profile_id=profile_id, language=language, tts_engine=tts_engine,
        temperature=temperature, top_k=top_k, top_p=top_p, speed=speed,
        repetition_penalty=repetition_penalty, gap_ms=gap_ms, speaker_map=speaker_map,
        cfg_strength=cfg_strength, target_rms=target_rms,
        sway_sampling_coef=sway_sampling_coef,
    )


@app.post("/synthesize")
async def synthesize(
    text: str          = Form(...),
    profile_id: str    = Form(...),
    language: str      = Form(default="en"),
    tts_engine: str    = Form(default="xtts"),   # "xtts" | "f5"
    temperature: float = Form(default=0.65),
    top_k: int         = Form(default=50),
    top_p: float       = Form(default=0.85),
    speed: float       = Form(default=1.0),
    repetition_penalty: float = Form(default=5.0),
    gap_ms: int        = Form(default=60),
    speaker_map: str   = Form(default=""),
    cfg_strength: float       = Form(default=2.0),    # F5 tone knobs (ignored by XTTS)
    target_rms: float         = Form(default=0.1),
    sway_sampling_coef: float = Form(default=-1.0),
    _key: None         = Depends(verify_api_key),
):
    """Legacy synchronous synthesis. Runs in the shared executor so it does
    not block the event loop and stays serialized with queued jobs."""
    params = _synth_params(text, profile_id, language, tts_engine, temperature,
                           top_k, top_p, speed, repetition_penalty, gap_ms, speaker_map,
                           cfg_strength, target_rms, sway_sampling_coef)
    loop = asyncio.get_event_loop()
    out_path = await loop.run_in_executor(_synth_executor, lambda: _perform_synthesis(**params))
    return FileResponse(
        out_path,
        media_type="audio/wav",
        headers={"Content-Disposition": "attachment; filename=synthesized.wav"},
    )


@app.post("/synthesize/submit")
async def synthesize_submit(
    text: str          = Form(...),
    profile_id: str    = Form(...),
    language: str      = Form(default="en"),
    tts_engine: str    = Form(default="xtts"),
    temperature: float = Form(default=0.65),
    top_k: int         = Form(default=50),
    top_p: float       = Form(default=0.85),
    speed: float       = Form(default=1.0),
    repetition_penalty: float = Form(default=5.0),
    gap_ms: int        = Form(default=60),
    speaker_map: str   = Form(default=""),
    cfg_strength: float       = Form(default=2.0),    # F5 tone knobs (ignored by XTTS)
    target_rms: float         = Form(default=0.1),
    sway_sampling_coef: float = Form(default=-1.0),
    _key: None         = Depends(verify_api_key),
):
    """Enqueue a synthesis job and return its id immediately."""
    _cleanup_synth_jobs()
    params = _synth_params(text, profile_id, language, tts_engine, temperature,
                           top_k, top_p, speed, repetition_penalty, gap_ms, speaker_map,
                           cfg_strength, target_rms, sway_sampling_coef)
    job_id = uuid.uuid4().hex
    with _synth_jobs_lock:
        _synth_jobs[job_id] = {
            "status": "queued",
            "created_at": time.time(),
            "result_path": None,
            "error": None,
        }
        queued_ahead = sum(1 for j in _synth_jobs.values() if j["status"] in ("queued", "processing")) - 1
    _synth_executor.submit(_run_synth_job, job_id, params)
    return {"job_id": job_id, "status": "queued", "queued_ahead": max(0, queued_ahead)}


@app.get("/synthesize/status/{job_id}")
async def synthesize_status(job_id: str, _key: None = Depends(verify_api_key)):
    """Poll a job's state. Returns {status: queued|processing|done|error}."""
    with _synth_jobs_lock:
        job = _synth_jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Job not found or expired.")
        resp = {"job_id": job_id, "status": job["status"]}
        if job["status"] == "error":
            resp["error"] = job.get("error", "Synthesis failed.")
            resp["code"] = job.get("code", 500)
        return resp


@app.get("/synthesize/result/{job_id}")
async def synthesize_result(job_id: str, _key: None = Depends(verify_api_key)):
    """Download the finished WAV. 409 if not ready, 410 if it expired."""
    with _synth_jobs_lock:
        job = _synth_jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Job not found or expired.")
        status = job["status"]
        result_path = job.get("result_path")
        if status == "error":
            raise HTTPException(job.get("code", 500), job.get("error", "Synthesis failed."))
        if status not in ("done", "downloading"):
            raise HTTPException(409, "Synthesis not finished yet.")
        # Mark downloading so cleanup won't delete the file mid-transfer.
        job["status"] = "downloading"

    if not result_path or not os.path.exists(result_path):
        with _synth_jobs_lock:
            if job_id in _synth_jobs:
                _synth_jobs[job_id]["status"] = "done"
        raise HTTPException(410, "Result expired.")

    return FileResponse(
        result_path,
        media_type="audio/wav",
        headers={"Content-Disposition": "attachment; filename=synthesized.wav"},
    )


# ── LEGACY: CLONE-VOICE (one-shot, XTTS or F5) ────────────────────
@app.post("/clone-voice")
async def clone(
    text: str = Form(...),
    file: UploadFile = File(...),
    tts_engine: str = Form(default="xtts"),   # "xtts" | "f5"
    speed: float    = Form(default=1.0),
    cfg_strength: float       = Form(default=2.0),    # F5 tone knobs (ignored by XTTS)
    target_rms: float         = Form(default=0.1),
    sway_sampling_coef: float = Form(default=-1.0),
    _key: None = Depends(verify_api_key),
):
    engine = tts_engine.lower().strip()
    if engine not in ("xtts", "f5", "chatterbox"):
        engine = "xtts"

    if engine == "f5" and not f5_usable():
        raise HTTPException(503,
            "F5-TTS requires a GPU server and is disabled on this CPU-only instance. "
            "Please switch to XTTS v2.")
    if engine == "chatterbox" and not chatterbox_usable():
        raise HTTPException(503, "Chatterbox is not available on this server. Please switch to XTTS v2 or F5-TTS.")
    if engine == "xtts" and not models["xtts"]:
        raise HTTPException(503, "XTTS v2 model is not available.")

    await check_file_size(file)
    if len(text) > 50_000:
        raise HTTPException(400, "Text exceeds 50 000 character limit.")
    raw_path = tmp_path("ref_raw")
    ref_path = tmp_path("ref", ".wav")
    out_path = tmp_path("clone", ".wav")
    chunk_paths: list[str] = []  # initialized here (not just in try) so the
                                  # finally block can't NameError if an early
                                  # step (e.g. convert_to_wav) fails first

    try:
        with open(raw_path, "wb") as b:
            b.write(await file.read())

        if not convert_to_wav(raw_path, ref_path):
            raise HTTPException(400, "Could not convert reference audio.")

        trim_silence(ref_path)

        # For F5, pre-transcribe the reference once so all chunks share the
        # same ref_text instead of each chunk triggering (and risking a
        # different) auto-transcription.
        ref_text = ""
        if engine == "f5" and models["stt"] is not None:
            try:
                ref_text = models["stt"].transcribe(ref_path)["text"].strip()
            except Exception as e:
                print(f"[clone-voice] Reference transcription failed (non-fatal, F5 will auto-transcribe): {e}")

        # For XTTS, compute conditioning latents from the reference ONCE and
        # reuse them for every chunk — tts_to_file(speaker_wav=...) would
        # otherwise re-derive conditioning from the file on every single
        # chunk call, which can drift subtly between chunks of the same clip.
        one_shot_latents = None
        if engine == "xtts":
            model = _get_raw_xtts_model()
            if model is not None:
                try:
                    one_shot_latents = model.get_conditioning_latents(
                        audio_path=ref_path, gpt_cond_len=30, max_ref_length=60,
                    )
                except Exception as e:
                    print(f"[clone-voice] Could not precompute latents, falling back to per-chunk speaker_wav: {e}")

        chunks = split_into_chunks(text.strip()) or [text.strip()]
        chunk_paths = []
        for i, chunk in enumerate(chunks):
            cp = tmp_path(f"clone_chunk_{i}", ".wav")
            chunk_paths.append(cp)
            if engine == "f5":
                synthesize_chunk_f5(chunk=chunk, ref_wav=ref_path,
                                    speed=max(0.5, min(2.0, speed)),
                                    chunk_path=cp,
                                    cfg_strength=cfg_strength, target_rms=target_rms,
                                    sway_sampling_coef=sway_sampling_coef, ref_text=ref_text)
            elif engine == "chatterbox":
                synthesize_chunk_chatterbox(chunk=chunk, ref_wav=ref_path,
                                            speed=max(0.5, min(2.0, speed)),
                                            chunk_path=cp, language_id="en")
            elif one_shot_latents is not None:
                gpt_cond_latent, speaker_embedding = one_shot_latents
                try:
                    xtts_synthesize_with_latents(
                        text=chunk, language="en",
                        gpt_cond_latent=gpt_cond_latent, speaker_embedding=speaker_embedding,
                        file_path=cp, temperature=0.65, top_k=50, top_p=0.85,
                        speed=max(0.5, min(2.0, speed)), repetition_penalty=5.0,
                    )
                except Exception as e:
                    print(f"[clone-voice] Inference from precomputed latents failed, falling back: {e}")
                    models["xtts"].tts_to_file(
                        text=chunk, speaker_wav=ref_path, language="en", file_path=cp,
                        temperature=0.65, top_k=50, top_p=0.85,
                        speed=max(0.5, min(2.0, speed)), enable_text_splitting=False,
                    )
            else:
                models["xtts"].tts_to_file(
                    text=chunk,
                    speaker_wav=ref_path,
                    language="en",
                    file_path=cp,
                    temperature=0.65,
                    top_k=50,
                    top_p=0.85,
                    speed=max(0.5, min(2.0, speed)),
                    enable_text_splitting=False,
                )

        if len(chunk_paths) == 1:
            import shutil
            shutil.copy(chunk_paths[0], out_path)
        else:
            concatenate_wavs(chunk_paths, out_path)

        # RVC pass — /clone-voice doesn't take a profile_id (it clones
        # straight from the uploaded reference file each call), so there's
        # no persistent profile to look up a trained model under. This is
        # a no-op unless a caller starts passing a profile_id here too.
        out_path = apply_rvc_conversion(out_path, None)

        return FileResponse(out_path, media_type="audio/wav")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Cloning failed ({engine}): {e}")
    finally:
        for p in [raw_path, ref_path] + chunk_paths:
            if os.path.exists(p):
                os.remove(p)


@app.post("/export/mp3")
async def export_mp3(
    file: UploadFile = File(...),
    _key: None = Depends(verify_api_key),
):
    """Convert an uploaded WAV file to MP3 using ffmpeg."""
    await check_file_size(file)
    wav_path = tmp_path("export_in", ".wav")
    mp3_path = tmp_path("export_out", ".mp3")
    try:
        with open(wav_path, "wb") as f:
            f.write(await file.read())

        result = subprocess.run(
            ["ffmpeg", "-y", "-i", wav_path, "-q:a", "4", mp3_path],
            capture_output=True,
        )
        if result.returncode != 0:
            raise HTTPException(500, f"ffmpeg error: {result.stderr.decode()[:200]}")

        return FileResponse(mp3_path, media_type="audio/mpeg", filename="export.mp3")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"MP3 export failed: {e}")
    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)