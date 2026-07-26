FROM python:3.10-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsox-dev \
    sox \
    gcc \
    g++ \
    libsndfile1 \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ── Pin torch to CPU-only BEFORE anything else ──────────────────────
# This constraints file prevents pip from upgrading torch to a CUDA
# variant when f5-tts (or any other package) resolves its dependencies.
RUN pip install --no-cache-dir \
    torch==2.2.2+cpu \
    torchaudio==2.2.2+cpu \
    --index-url https://download.pytorch.org/whl/cpu

# transformers is pinned here too — f5-tts's own deps (accelerate,
# transformers_stream_generator, datasets) have no upper bound and pip's
# resolver will otherwise silently upgrade transformers past what
# coqui-tts/XTTS v2 needs, breaking it even though f5-tts itself never
# loads on a CPU-only box.
RUN echo "torch==2.2.2+cpu" > /tmp/cpu_constraints.txt && \
    echo "torchaudio==2.2.2+cpu" >> /tmp/cpu_constraints.txt && \
    echo "transformers==4.36.2" >> /tmp/cpu_constraints.txt

# ── Core audio/API deps ──────────────────────────────────────────────
RUN pip install --no-cache-dir \
    fastapi \
    uvicorn \
    python-multipart \
    openai-whisper \
    "tts==0.22.0" \
    "transformers==4.36.2" \
    soundfile \
    numpy

# ── F5-TTS — installed with constraints so it can't pull CUDA torch ──
# The -c flag forces pip to respect our CPU torch pin AND the transformers
# pin above. If F5-TTS's deps need a newer transformers than 4.36.2, this
# install will fail cleanly and fall through to the warning below —
# XTTS v2 stays intact either way.
RUN pip install --no-cache-dir \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    -c /tmp/cpu_constraints.txt \
    f5-tts || \
    echo "WARNING: f5-tts install failed — XTTS v2 still available"

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]