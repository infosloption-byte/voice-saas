FROM python:3.10-slim

WORKDIR /app

# 1. Install system tools for audio and building
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsox-dev \
    gcc \
    g++ \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# 2. Install all Python dependencies in ONE step.
# Pin matching versions for torch and torchaudio, and use --extra-index-url
# so pip can find the CPU wheels while still fetching other packages from PyPI.
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu \
    torch==2.2.2+cpu \
    torchaudio==2.2.2+cpu \
    fastapi \
    uvicorn \
    python-multipart \
    openai-whisper \
    tts==0.22.0 \
    transformers==4.36.2

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]