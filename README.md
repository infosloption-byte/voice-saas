# Chatterbox → separate service (fixes the ResolutionImpossible build error)

## What happened
`pip install chatterbox-tts` inside `ai-engine` failed with a real, permanent conflict:
```
chatterbox-tts depends on torch==2.6.0 and transformers==4.46.3
ai-engine (XTTS) is pinned to torch==2.2.2+cpu and transformers==4.36.2
ERROR: ResolutionImpossible
```
No install flag or constraint fixes this — the two pins don't overlap at all. Chatterbox now runs as its **own container** (`chatterbox-engine`), and `ai-engine` talks to it over HTTP instead of importing it directly.

## What's in this package

**Root-level architecture fix** (13 files — apply these):
| File | What changed |
|---|---|
| `chatterbox-engine/Dockerfile`, `main.py`, `requirements.txt` | **New service.** Installs Chatterbox's real required versions in total isolation. Exposes `/` (status) and `/synthesize`. |
| `ai-engine/main.py` | `synthesize_chunk_chatterbox()` now proxies over HTTP via `httpx`. `chatterbox_usable()`/`chatterbox_languages()` poll the sub-service with a 15s TTL cache. Removed the old in-process model loading entirely. |
| `ai-engine/Dockerfile` | Removed the permanently-broken in-process Chatterbox install; added `httpx`. |
| `ai-engine/requirements.txt` | Removed `chatterbox-tts` (can never install here); points to `chatterbox-engine/requirements.txt` instead. |
| `docker-compose.yml` | Added the `chatterbox-engine` service, a `chatterbox_models` volume, wired `CHATTERBOX_ENGINE_URL` into `ai-engine`. **This is the file your server actually runs.** |
| `docker-compose.prod.yml` | Same wiring, for the alternate full-stack file. |
| `docker-compose.gcp.yml`, `docker-compose.runpod.yml` | These run only `ai-engine` remotely on a GPU box — Chatterbox intentionally stays on your main server. Added a comment + made the URL overridable. |
| `backend/.env.example` | Noted that `AI_ENGINE_API_KEY` now also gates `chatterbox-engine`. |
| `.gitignore` | Added `__pycache__/`/`*.pyc` (almost got a compiled bytecode file committed by accident). |
| `docs/ENHANCEMENT_TASKS.md` | Full write-up of the conflict and the fix. |

**`frontend-src-reorganized/`** — this is the **same** `frontend/src/` folder reorg (into `app/`, `pages/`, `components/`, `lib/`) from earlier in this conversation, included here again for convenience in case you haven't applied it yet. If you already applied the earlier `src.zip`, you can ignore this folder — nothing new changed here.

## How to apply

1. Copy the 13 root-level files into your repo at their listed paths (overwriting existing ones), plus create the new `chatterbox-engine/` folder.
2. If you haven't already, replace `frontend/src/` with `frontend-src-reorganized/`'s contents.
3. Commit:
   ```bash
   git add .
   git commit -m "Move Chatterbox to its own service; reorganize frontend/src"
   git push origin main
   ```
4. On the server:
   ```bash
   cd /var/www/voxora
   docker compose up -d --build ai-engine chatterbox-engine frontend backend
   ```
5. Check it actually loaded:
   ```bash
   docker compose logs chatterbox-engine
   ```
   Look for `✓ Chatterbox ready`. Then check `ai-engine` sees it:
   ```bash
   docker compose logs ai-engine | grep -i chatterbox
   ```
   Should say `✓ Chatterbox ready (via http://chatterbox-engine:8100)` — it may briefly say "not reachable yet" if `ai-engine` finishes starting before `chatterbox-engine` does; that's fine, it's rechecked automatically every 15 seconds.

## Known limitation
This was built and verified for syntax/structure (Python compiles, YAML parses, frontend builds clean) in a sandboxed environment without the ability to run `docker compose up` against real hardware. Please run the steps above and let me know what `docker compose logs chatterbox-engine` shows — happy to debug further if anything comes up on the first real run.
