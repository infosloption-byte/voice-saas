# Hotfix: Docker build failure on `docker compose up --build ai-engine`

## The error you hit
```
ERROR: Could not find a version that satisfies the requirement flit_core<4,>=3.11 (from versions: none)
ERROR: No matching distribution found for flit_core
```
Happened in the `torch`/`torchaudio` install step.

## Root cause
`ai-engine/Dockerfile` used `--index-url` for the torch/torchaudio install, which **replaces** the default PyPI index entirely instead of adding to it. Pip had nowhere to resolve a transitive build dependency (`flit_core`, needed to build `typing_extensions` from source) and the build failed. The fix further down in the same Dockerfile (the F5-TTS install) already correctly used `--extra-index-url` — the primary torch install just never matched it.

## What's in this package
1. **`ai-engine/Dockerfile`** — fixed `--index-url` → `--extra-index-url` for the torch install. Also adds a proper `chatterbox-tts` install step (mirroring F5-TTS's pattern with the same CPU-constraint protection and non-fatal fallback) — this was a bug in the previous delivery: `requirements.txt` was updated to include `chatterbox-tts` but the Dockerfile never actually reads that file, so Chatterbox was never really getting installed in your deployment.
2. **`ai-engine/requirements.txt`** — annotated as a manual-setup reference only (not the Docker build's source of truth), and fixed the same `--index-url` mistake in its own torch line.
3. **`docs/ENHANCEMENT_TASKS.md`** — updated with a correction note documenting both bugs.

## Apply and rebuild

```bash
# copy ai-engine/Dockerfile, ai-engine/requirements.txt, docs/ENHANCEMENT_TASKS.md
# into your repo at those paths, then:

git add ai-engine/Dockerfile ai-engine/requirements.txt docs/ENHANCEMENT_TASKS.md
git commit -m "Fix Docker build failure and wire chatterbox-tts into the real Dockerfile"
git push origin main

# on the server:
docker compose up -d --build ai-engine frontend backend
```

The build should now complete. F5-TTS and Chatterbox both install with non-fatal fallbacks — if either fails for any other reason, you'll see a `WARNING: ... install failed` line but the build will still succeed and XTTS v2 will remain available.
