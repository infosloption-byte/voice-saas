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
    && rm -rf /var/lib/apt/lists/*

# Python dependencies — pin torch CPU wheels
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

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]