FROM python:3.10-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ── Why this is a separate container from ai-engine ──────────────────
# Chatterbox hard-pins torch==2.6.0 and transformers==4.46.3. ai-engine's
# XTTS v2 (via coqui-tts) needs transformers in roughly the 4.33-4.41
# range and is pinned to torch==2.2.2+cpu. Those are two non-overlapping
# hard version pins — `pip install chatterbox-tts` inside ai-engine fails
# with a real ResolutionImpossible error, not a theoretical conflict.
# Chatterbox gets its own container with its own dependency set instead.
#
# CPU-only build: swap this for the CUDA wheel index on a GPU host if
# you want faster inference — same pattern ai-engine uses for its own
# CPU pin.
RUN pip install --no-cache-dir \
    torch==2.6.0 \
    torchaudio==2.6.0 \
    --extra-index-url https://download.pytorch.org/whl/cpu

RUN pip install --no-cache-dir \
    fastapi \
    uvicorn \
    python-multipart \
    soundfile \
    numpy \
    chatterbox-tts

COPY . .

EXPOSE 8100

HEALTHCHECK --interval=15s --timeout=10s --retries=10 --start-period=180s \
    CMD curl -f http://localhost:8100/ || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8100"]
