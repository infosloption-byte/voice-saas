# Support running chatterbox-engine on a separate EC2 instance

Fixes the OOM restart-loop you hit: `ai-engine` + `chatterbox-engine` running together exceeded your instance's RAM. This lets Chatterbox run on its own dedicated box instead.

**If you already applied the previous `voxora-chatterbox-fix.zip`, only these files actually changed in this update:**
- `docker-compose.yml`
- `docker-compose.prod.yml`
- `.env.example`
- `docker-compose.chatterbox-remote.yml` (**new file**)
- `docs/ENHANCEMENT_TASKS.md`

Everything else in this zip (`ai-engine/`, `chatterbox-engine/`, `.gitignore`, `backend/.env.example`, `docker-compose.gcp.yml`, `docker-compose.runpod.yml`) is included for completeness but is **unchanged** from the last package — safe to skip if you already have them.

## What changed

1. **`CHATTERBOX_ENGINE_URL` is now overridable**, not hardcoded to the local container name. Set it in `.env` to point at your new box.
2. **The local `chatterbox-engine` service is now opt-in** via a Compose profile — a plain `docker compose up -d` will no longer try to build/start it locally, avoiding wasted resources once you're running it remotely.
3. **New `docker-compose.chatterbox-remote.yml`** — a standalone compose file for the new EC2 instance, running only Chatterbox.

## Setup: on the NEW EC2 instance (Chatterbox only)

1. Copy just the `chatterbox-engine/` folder there.
2. Copy `docker-compose.chatterbox-remote.yml` there too.
3. In that instance's `.env` (or directly in the compose file), set:
   ```
   AI_ENGINE_API_KEY=<the SAME value as on your main server>
   ```
   This is the shared secret `ai-engine` sends in the `X-Engine-Key` header — it has to match, or requests get a 401.
4. Start it:
   ```bash
   docker compose -f docker-compose.chatterbox-remote.yml up -d --build
   docker compose -f docker-compose.chatterbox-remote.yml logs -f
   ```
   Wait for `✓ Chatterbox ready`.
5. **Security Group:** open port `8100` on this instance, ideally restricted to just your main server's IP (not the whole internet). The API key is defense-in-depth, not a substitute for network restriction.
6. Sanity check from anywhere: `curl http://THIS_INSTANCE_IP:8100/` should return `{"status":"Online", ...}`.

## Setup: back on your MAIN server (`/var/www/voxora`)

1. Apply the updated files from this zip.
2. In your main server's `.env`, add:
   ```
   CHATTERBOX_ENGINE_URL=http://YOUR_NEW_INSTANCE_IP:8100
   ```
3. Stop the local Chatterbox container (it's no longer used) and bring everything else up cleanly:
   ```bash
   docker compose up -d --remove-orphans
   ```
   `--remove-orphans` stops the currently-running local `voice_chatterbox` container, since it's no longer part of the active service set once you're pointing remotely.
4. Confirm:
   ```bash
   docker compose logs ai-engine | grep -i chatterbox
   ```
   Should say `✓ Chatterbox ready (via http://YOUR_NEW_INSTANCE_IP:8100)` — and `ai-engine` should stay stable (no more restart loop) now that the memory pressure is split across two machines.

## If you ever want Chatterbox back on the main server instead

```bash
# remove/comment CHATTERBOX_ENGINE_URL from .env, then:
docker compose --profile local-chatterbox up -d
```
