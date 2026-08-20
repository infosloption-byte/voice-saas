# Video Dubbing MVP — Task #6 delivery

Drop these into `voice-saas/` at the matching paths (they mirror the repo
structure exactly, so it's a straight copy-over):

## New files
- `backend/database/migrations/2026_08_20_000001_create_video_dubbing_jobs_table.php`
- `backend/app/Models/DubbingJob.php`
- `backend/app/Jobs/VideoDubbingJob.php`
- `backend/app/Http/Controllers/VideoDubbingController.php`

## Updated files (replace in place)
- `ai-engine/main.py` — added `/transcribe/segments` only; nothing else touched
- `backend/routes/api.php` — added the `/dubbing/*` route group + one `use` import
- `backend/config/filesystems.php` — added the `video` disk
- `.env.example` — documented `VIDEO_DISK` / `VIDEO_BUCKET`

## Deploy steps
1. Copy files to matching paths.
2. `php artisan migrate` (creates `video_dubbing_jobs`).
3. Rebuild/restart `ai-engine` (new endpoint, no new dependencies — pure Python, no requirements.txt change).
4. Restart the queue worker so it picks up the new `VideoDubbingJob` class.
5. Optionally set `VIDEO_DISK=s3` / `VIDEO_BUCKET` in `.env` if you want dubbed videos on S3 from day one; defaults to local disk (`storage/app/video`) otherwise.

## Not included in this pass (frontend + follow-ups)
- **Frontend UI** — upload widget, language picker, progress poller, download
  button. The API surface (`/dubbing/submit`, `/dubbing/status/{jobId}`,
  `/dubbing/result/{jobId}`) is stable and ready for it.
- **End-to-end run on real hardware** — this was built and syntax/structure-
  verified (Python compile, PHP brace/paren balance) without the ability to
  run `docker compose up` + a real video through the pipeline in this
  sandbox, consistent with how prior corrections in `ENHANCEMENT_TASKS.md`
  (task #4) were flagged. Please test with a real short video before
  considering this fully closed, and watch `segment_overflow_count` on a few
  real jobs — if it's consistently high, the "absorb into next gap" timing
  refinement discussed in planning is the next thing to build.
- **Video storage lifecycle** — no auto-prune job for dubbed videos yet
  (audio has `AUDIO_PRUNE_DAYS`; video has no equivalent). Worth adding once
  you see real storage volume.
