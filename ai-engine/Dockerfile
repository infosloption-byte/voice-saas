FROM python:3.10-slim

WORKDIR /app

# System tools for audio processing
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsox-dev \
    sox \
    gcc \
    g++ \
    libsndfile1 \
    git \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies — pin torch CPU wheels
# F5-TTS is installed separately after core deps to avoid resolver conflicts
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu \
    torch==2.2.2+cpu \
    torchaudio==2.2.2+cpu \
    fastapi \
    uvicorn \
    python-multipart \
    openai-whisper \
    tts==0.22.0 \
    transformers==4.36.2 \
    soundfile \
    numpy

# F5-TTS — installed in a second pass so a failure here doesn't block
# the image build; XTTS v2 remains fully functional without it.
RUN pip install --no-cache-dir f5-tts || \
    echo "WARNING: f5-tts install failed — XTTS v2 still available"

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]