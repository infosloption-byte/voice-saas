# Voxora

A self-hosted AI voice platform: clone voices, write and translate scripts, synthesize speech across multiple TTS engines, assemble multi-lane audio timelines, and dub video into other languages — all under your own infrastructure.

## Stack

- **Frontend** — React 19 + TypeScript, Vite
- **Backend** — Laravel 11 (PHP 8.4)
- **AI Engine** — FastAPI (Python), XTTS v2 + F5-TTS, Whisper for transcription
- **Chatterbox Engine** — separate FastAPI service (MIT-licensed TTS engine, isolated dependency environment — see `chatterbox-engine/Dockerfile` for why it can't share `ai-engine`'s Python environment)
- **Queue / cache** — Redis
- **Reverse proxy** — Nginx

## Repo structure

```
ai-engine/            XTTS v2 + F5-TTS + Whisper — FastAPI service
chatterbox-engine/     Chatterbox TTS — separate FastAPI service (own torch/transformers pins)
backend/               Laravel API — auth, billing, projects, scripts, jobs
frontend/              React app
  src/
    app/               App shells (App.tsx, AdminApp.tsx)
    pages/             Route-level page components
    components/        Shared reusable UI
    lib/                Shared logic/utilities (api client, types, engine metadata, etc.)
    hooks/              Shared React hooks
docs/                  Technical audit + prioritized enhancement roadmap
  PLATFORM_ANALYSIS.md
  ENHANCEMENT_TASKS.md
docker-compose.yml              Main deployment (single server, CPU-only by default)
docker-compose.prod.yml         Alternate full-stack config
docker-compose.gcp.yml          Remote GPU ai-engine (F5-TTS) on a GCP VM
docker-compose.runpod.yml       Remote GPU ai-engine (F5-TTS) on RunPod
docker-compose.chatterbox-remote.yml   Standalone Chatterbox on a separate instance
```

## Local / production deployment

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# fill in the required values — see comments in each .env.example

docker compose up -d --build
docker compose exec backend php artisan migrate
```

Chatterbox is opt-in (not started by a plain `docker compose up`) since it's memory-heavy alongside XTTS/Whisper on a single small instance:
```bash
# run Chatterbox locally too, if you have RAM to spare:
docker compose --profile local-chatterbox up -d

# OR run it on a separate instance — see docker-compose.chatterbox-remote.yml
# and set CHATTERBOX_ENGINE_URL in .env to point at it
```

See `docs/ENHANCEMENT_TASKS.md` for deployment notes on running F5-TTS on a remote GPU host (GCP/RunPod).

## Admin

- **AI Engines** (`/admin` → AI Engines) — swaps which `ai-engine` *host* the backend talks to (local vs. a remote GPU deployment). One active host at a time.
- **TTS Engines** (`/admin` → TTS Engines) — independently enable/disable each *engine* (XTTS/F5/Chatterbox) offered to users, regardless of which host is active. Separate concept from the above — see the warning text on the AI Engines page for the distinction.

## Docs

- `docs/PLATFORM_ANALYSIS.md` — full technical audit and competitive analysis
- `docs/ENHANCEMENT_TASKS.md` — prioritized roadmap, kept current as tasks complete, with notes on what was actually built for each
