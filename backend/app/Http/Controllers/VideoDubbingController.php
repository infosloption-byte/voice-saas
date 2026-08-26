<?php

namespace App\Http\Controllers;

use App\Jobs\PrepareDubbingJob;
use App\Jobs\FinalizeDubbingJob;
use App\Models\ActivityLog;
use App\Models\DubbingJob;
use App\Models\VideoProjectAsset;
use App\Models\VoiceProfile;
use App\Services\EngineResolver;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Task #6 (Video dubbing MVP), evolved into a proper workspace: list/delete
 * added alongside the original submit/status/result so the frontend can
 * show upload history, support several jobs in flight at once, and let
 * people manage (and clean up) their dubs — not just fire-and-forget one
 * at a time.
 *
 * Aug 22, 2026: split into a two-phase flow so the user can review/edit
 * segment timing and translated text on a real timeline before synthesis
 * runs — see PrepareDubbingJob / FinalizeDubbingJob and task #6 in
 * docs/ENHANCEMENT_TASKS.md. submit()/retry() now kick off
 * PrepareDubbingJob only; segments()/updateSegments()/finalize() are the
 * new endpoints the review timeline uses.
 */
class VideoDubbingController extends Controller
{
    /** Max upload size in KB (200MB) — video is heavier than any other upload in this app. */
    private const MAX_UPLOAD_KB = 204800;

    /** How many jobs the workspace list view shows. Small per-user volume expected; add pagination if that changes. */
    private const LIST_LIMIT = 100;

    /**
     * POST /api/dubbing/submit
     * multipart: video (file), target_language, voice_profile_id, source_language? (optional)
     *
     * video_project_id (optional, task #15 Phase 1): when the Video Studio
     * page submits a dub from inside a project, this attaches the new job
     * to that project's media bin as a 'video'/'upload' asset (see
     * VideoProjectAsset). Omitted entirely for any caller outside project
     * context (e.g. an older client, or a direct API caller) — the job
     * behaves exactly as it always has, just with no bin entry pointing at
     * it. This intentionally keeps submit() the single upload+dub action it
     * has always been rather than splitting it into a separate "add to
     * bin" + "dub" call — that split is what Phase 3's dubClip() is for,
     * once a video can sit in the bin undubbed.
     */
    public function submit(Request $request)
    {
        $user = $request->user();

        $validated = $request->validate([
            'video'             => ['required', 'file', 'mimetypes:video/mp4,video/quicktime,video/x-matroska,video/webm', 'max:' . self::MAX_UPLOAD_KB],
            'target_language'   => ['required', 'string', 'max:10'],
            'source_language'   => ['nullable', 'string', 'max:10'],
            'voice_profile_id'  => ['required', 'string', 'max:100'],
            // Same TTSEngine choice already sent for scripts/bulk synthesis
            // (see useTTSEngine.ts) — nullable so FinalizeDubbingJob can
            // fall back to a sane default if an older client omits it.
            'engine'            => ['nullable', 'string', EngineResolver::engineValidationRule()],
            // Task #15 Phase 1 — see docblock above.
            'video_project_id'  => ['nullable', 'uuid'],
        ]);

        // Ownership check for real (non-builtin) voice profiles, same pattern
        // BulkSynthesisJob's queueBulk uses for scripts belonging to a project.
        $profileId = $validated['voice_profile_id'];
        if ($profileId !== '' && ! str_starts_with($profileId, 'builtin:')) {
            $owned = VoiceProfile::where('user_id', $user->id)
                ->where('profile_id', $profileId)
                ->exists();
            if (! $owned) {
                return response()->json(['message' => 'Voice profile not found on your account.'], 422);
            }
        }

        // Task #15 Phase 1 — fail fast (before any upload/storage work) if
        // a project id was passed but doesn't belong to this user, same
        // ownership-check-before-side-effects order as the voice profile
        // check just above.
        $project = null;
        if (! empty($validated['video_project_id'])) {
            $project = $user->videoProjects()->find($validated['video_project_id']);
            if (! $project) {
                return response()->json(['message' => 'Video project not found.'], 404);
            }
        }

        $jobId = (string) Str::uuid();
        // 'video/' prefix matters once VIDEO_BUCKET falls back to the same
        // bucket as 'audio' (see filesystems.php) — audio keys have no
        // prefix at all ({userId}/...), so this keeps the two cleanly
        // separable by key for any future per-type S3 lifecycle policy,
        // even when they're sitting in the identical bucket.
        $storedPath = 'video/' . $user->id . '/' . $jobId . '_source.mp4';

        Storage::disk('video')->put($storedPath, file_get_contents($validated['video']->getRealPath()));

        $log = ActivityLog::create([
            'user_id'    => $user->id,
            'event_type' => 'dubbing',
            'message'    => 'Video dubbing queued (' . strtoupper($validated['target_language']) . ')',
            'status'     => 'running',
            'started_at' => now(),
        ]);

        $job = DubbingJob::create([
            'id'                => $jobId,
            'user_id'           => $user->id,
            'activity_log_id'   => $log->id,
            'voice_profile_id'  => $profileId,
            'engine'            => $validated['engine'] ?? null,
            'source_language'   => $validated['source_language'] ?? null,
            'target_language'   => $validated['target_language'],
            'original_filename' => $validated['video']->getClientOriginalName(),
            'status'            => 'queued',
            'progress'          => 0,
            'source_video_path' => $storedPath,
        ]);

        PrepareDubbingJob::dispatch($job->id);

        // Task #15 Phase 1 — attach this upload to the project's bin. Not
        // wrapped in the same transaction as the DubbingJob insert above:
        // if this insert fails, the job itself is still valid and running
        // (it just won't show up in the project's bin) rather than losing
        // an already-uploaded, already-queued job over a secondary write.
        if ($project) {
            VideoProjectAsset::create([
                'video_project_id'  => $project->id,
                'kind'              => 'video',
                'source'            => 'upload',
                'dubbing_job_id'    => $job->id,
                'original_filename' => $validated['video']->getClientOriginalName(),
                'storage_path'      => $storedPath,
                'status'            => 'ready',
            ]);
            $project->touch();
        }

        return response()->json([
            'job_id'          => $job->id,
            'status'          => 'queued',
            'activity_log_id' => $log->id,
        ]);
    }

    /**
     * POST /api/dubbing/{jobId}/retry — start a fresh dubbing job reusing
     * an existing job's already-uploaded source video, so the user isn't
     * forced to download-then-reupload the same file to change a setting
     * or try again after a failure. The stored video is copied (not
     * pointed at directly) into a new key under the new job's own id, so
     * the two jobs' file lifecycles stay fully independent — deleting
     * either one later can never silently break the other.
     */
    public function retry(Request $request, string $jobId)
    {
        $user = $request->user();
        $source = DubbingJob::where('id', $jobId)->where('user_id', $user->id)->first();
        if (! $source) {
            return response()->json(['message' => 'Original dubbing job not found.'], 404);
        }
        if (! Storage::disk('video')->exists($source->source_video_path)) {
            return response()->json(['message' => 'Original upload is no longer available — please upload the video again.'], 410);
        }

        $validated = $request->validate([
            'target_language'   => ['required', 'string', 'max:10'],
            'source_language'   => ['nullable', 'string', 'max:10'],
            'voice_profile_id'  => ['required', 'string', 'max:100'],
            'engine'            => ['nullable', 'string', EngineResolver::engineValidationRule()],
        ]);

        $profileId = $validated['voice_profile_id'];
        if ($profileId !== '' && ! str_starts_with($profileId, 'builtin:')) {
            $owned = VoiceProfile::where('user_id', $user->id)
                ->where('profile_id', $profileId)
                ->exists();
            if (! $owned) {
                return response()->json(['message' => 'Voice profile not found on your account.'], 422);
            }
        }

        $jobId = (string) Str::uuid();
        $storedPath = 'video/' . $user->id . '/' . $jobId . '_source.mp4';
        Storage::disk('video')->copy($source->source_video_path, $storedPath);

        $log = ActivityLog::create([
            'user_id'    => $user->id,
            'event_type' => 'dubbing',
            'message'    => 'Video dubbing queued (' . strtoupper($validated['target_language']) . ')',
            'status'     => 'running',
            'started_at' => now(),
        ]);

        $job = DubbingJob::create([
            'id'                => $jobId,
            'user_id'           => $user->id,
            'activity_log_id'   => $log->id,
            'voice_profile_id'  => $profileId,
            'engine'            => $validated['engine'] ?? $source->engine,
            'source_language'   => $validated['source_language'] ?? null,
            'target_language'   => $validated['target_language'],
            'original_filename' => $source->original_filename,
            'status'            => 'queued',
            'progress'          => 0,
            'source_video_path' => $storedPath,
        ]);

        PrepareDubbingJob::dispatch($job->id);

        // Task #15 Phase 1 — if the job being retried was itself a
        // project's bin asset, the retry is still conceptually "the same
        // clip", so point the project at the new job id rather than
        // leaving the bin referencing the old (failed/superseded) one.
        // No asset is created here if none already existed — a job with
        // no project association stays that way on retry, same as submit().
        $sourceAsset = VideoProjectAsset::where('dubbing_job_id', $source->id)->first();
        if ($sourceAsset) {
            $sourceAsset->update([
                'dubbing_job_id' => $job->id,
                'storage_path'   => $storedPath,
                'status'         => 'ready',
            ]);
            $sourceAsset->project?->touch();
        }

        return response()->json([
            'job_id'          => $job->id,
            'status'          => 'queued',
            'activity_log_id' => $log->id,
        ]);
    }

    /**
     * GET /api/dubbing/{jobId}/thumbnails — metadata for the review
     * timeline's thumbnail filmstrip (frame count, spacing, per-thumb
     * pixel size). Generates and caches a single tiled sprite image on
     * first request (see thumbnailSprite() for the actual bytes) rather
     * than one file per frame — one HTTP request for the whole filmstrip,
     * one ffmpeg call, one cached file to clean up.
     *
     * Runs the extraction synchronously in this request rather than as a
     * background job — acceptable for the video lengths this app expects
     * (same 200MB/short-form ceiling as upload itself), but if much longer
     * videos become common this should move to a queued job like the rest
     * of the pipeline instead of blocking the request.
     */
    public function thumbnails(Request $request, string $jobId)
    {
        $job = DubbingJob::where('id', $jobId)->where('user_id', $request->user()->id)->first();
        if (! $job) {
            return response()->json(['message' => 'Dubbing job not found.'], 404);
        }
        if (! Storage::disk('video')->exists($job->source_video_path)) {
            return response()->json(['message' => 'Original upload is no longer available.'], 410);
        }

        try {
            $meta = $this->ensureThumbnailSprite($job);
        } catch (\Throwable $e) {
            return response()->json(['message' => 'Could not generate thumbnails: ' . $e->getMessage()], 500);
        }

        return response()->json($meta);
    }

    /** GET /api/dubbing/{jobId}/thumbnails/sprite.jpg — the actual tiled filmstrip image. */
    public function thumbnailSprite(Request $request, string $jobId)
    {
        $job = DubbingJob::where('id', $jobId)->where('user_id', $request->user()->id)->first();
        if (! $job) {
            return response()->json(['message' => 'Dubbing job not found.'], 404);
        }

        $spritePath = $this->thumbnailSpritePath($job);
        if (! Storage::disk('video')->exists($spritePath)) {
            // Defensive — the frontend always calls thumbnails() first,
            // which generates this, but don't 500 if hit directly/early.
            try {
                $this->ensureThumbnailSprite($job);
            } catch (\Throwable $e) {
                return response()->json(['message' => 'Could not generate thumbnails: ' . $e->getMessage()], 500);
            }
        }

        return response($this->getVideoDiskContents($spritePath), 200, [
            'Content-Type'  => 'image/jpeg',
            'Cache-Control' => 'private, max-age=86400', // sprite is immutable once generated for a given job
        ]);
    }

    private function thumbnailSpritePath(DubbingJob $job): string
    {
        return 'video/' . $job->user_id . '/' . $job->id . '_sprite.jpg';
    }

    /**
     * Generates the tiled thumbnail sprite if it isn't already cached, and
     * returns the metadata the frontend needs to slice it up: how many
     * frames, how far apart in the source video, and each frame's pixel
     * size within the sprite (read back from the generated image itself
     * via getimagesize(), rather than assumed, since scale=WIDTH:-2 lets
     * ffmpeg pick a height that varies with the source video's aspect ratio).
     */
    private function ensureThumbnailSprite(DubbingJob $job): array
    {
        $thumbWidth  = 160;
        $maxThumbs   = 60;
        $minInterval = 1.0;

        $duration = (float) ($job->duration_seconds ?: 30.0);
        $interval = max($minInterval, $duration / $maxThumbs);
        $frameCount = max(1, (int) floor($duration / $interval) + 1);
        $columns = min($frameCount, 10);
        $rows = (int) ceil($frameCount / $columns);

        $spritePath = $this->thumbnailSpritePath($job);

        if (! Storage::disk('video')->exists($spritePath)) {
            $tmpDir = sys_get_temp_dir() . '/dubthumb_' . $job->id;
            @mkdir($tmpDir, 0700, true);

            try {
                $videoPath = $tmpDir . '/source.mp4';
                $sourceStream = Storage::disk('video')->readStream($job->source_video_path);
                if (! $sourceStream) {
                    throw new \RuntimeException('Could not read the source video.');
                }
                file_put_contents($videoPath, stream_get_contents($sourceStream));
                fclose($sourceStream);

                $spriteLocalPath = $tmpDir . '/sprite.jpg';
                $this->runFfmpegSync([
                    'ffmpeg', '-y', '-i', $videoPath,
                    '-vf', "fps=1/{$interval},scale={$thumbWidth}:-2,tile={$columns}x{$rows}",
                    '-frames:v', '1', '-q:v', '4',
                    $spriteLocalPath,
                ], 'Thumbnail sprite generation');

                if (! file_exists($spriteLocalPath) || filesize($spriteLocalPath) === 0) {
                    throw new \RuntimeException('ffmpeg produced no sprite output.');
                }

                Storage::disk('video')->put($spritePath, file_get_contents($spriteLocalPath));
            } finally {
                $this->rrmdirController($tmpDir);
            }
        }

        // Read the real generated dimensions back rather than assuming
        // thumbWidth * (some guessed aspect ratio) — scale=WIDTH:-2 means
        // ffmpeg itself picked the height based on this specific video.
        $spriteBytes = $this->getVideoDiskContents($spritePath);
        $tmpImg = tempnam(sys_get_temp_dir(), 'dubthumb_dim_') . '.jpg';
        file_put_contents($tmpImg, $spriteBytes);
        $dims = @getimagesize($tmpImg);
        @unlink($tmpImg);

        [$totalW, $totalH] = $dims ?: [$thumbWidth * $columns, (int) round($thumbWidth * 9 / 16) * $rows];

        return [
            'frame_count'      => $frameCount,
            'interval_seconds' => round($interval, 3),
            'columns'          => $columns,
            'rows'             => $rows,
            'thumb_width'      => (int) round($totalW / $columns),
            'thumb_height'     => (int) round($totalH / $rows),
            'sprite_url'       => "/api/dubbing/{$job->id}/thumbnails/sprite.jpg",
        ];
    }

    /** Small helper — Storage facades return streams/strings inconsistently across drivers; this normalizes to bytes. */
    private function getVideoDiskContents(string $path): string
    {
        $stream = Storage::disk('video')->readStream($path);
        $data = stream_get_contents($stream);
        fclose($stream);
        return $data;
    }

    /**
     * Minimal, self-contained ffmpeg runner for this controller — NOT a
     * duplicate of DubbingPipelineHelpers::runFfmpeg() by oversight, that
     * trait is written for the queued Job classes (assumes job/quota
     * context) and pulling a controller into using it would be an awkward
     * fit for one call site. Same hang-timeout protection either way.
     */
    private function runFfmpegSync(array $cmd, string $context, int $timeoutSeconds = 300): void
    {
        $proc = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (! is_resource($proc)) {
            throw new \RuntimeException("{$context}: could not start ffmpeg process.");
        }

        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);

        $stderr   = '';
        $deadline = microtime(true) + $timeoutSeconds;
        $killed   = false;

        while (true) {
            $status = proc_get_status($proc);
            stream_get_contents($pipes[1]); // drain stdout, unused
            $stderr .= (string) stream_get_contents($pipes[2]);

            if (! $status['running']) {
                break;
            }
            if (microtime(true) > $deadline) {
                proc_terminate($proc, 15);
                usleep(500_000);
                if (proc_get_status($proc)['running']) {
                    proc_terminate($proc, 9);
                }
                $killed = true;
                break;
            }
            usleep(100_000);
        }

        fclose($pipes[1]);
        fclose($pipes[2]);
        $exitCode = proc_close($proc);

        if ($killed) {
            throw new \RuntimeException("{$context} timed out after {$timeoutSeconds}s and was killed.");
        }
        if ($exitCode !== 0) {
            $tail = trim(preg_replace('/\s+/', ' ', $stderr));
            $tail = strlen($tail) > 500 ? '…' . substr($tail, -500) : $tail;
            throw new \RuntimeException("{$context} failed (ffmpeg exit {$exitCode}): {$tail}");
        }
    }

    private function rrmdirController(string $dir): void
    {
        if (! is_dir($dir)) return;
        foreach (scandir($dir) ?: [] as $f) {
            if ($f === '.' || $f === '..') continue;
            $path = "{$dir}/{$f}";
            is_dir($path) ? $this->rrmdirController($path) : @unlink($path);
        }
        @rmdir($dir);
    }

    /**
     * GET /api/dubbing/{jobId}/segments — the review timeline's data
     * source. Returns the segments array PrepareDubbingJob produced
     * (each: id, start, end, original, text), plus enough job metadata
     * for the editor to render around them.
     */
    public function segments(Request $request, string $jobId)
    {
        $job = DubbingJob::where('id', $jobId)->where('user_id', $request->user()->id)->first();
        if (! $job) {
            return response()->json(['message' => 'Dubbing job not found.'], 404);
        }
        if (! $job->segments_json) {
            return response()->json(['message' => 'No segments available for this job yet.', 'status' => $job->status], 409);
        }

        return response()->json([
            'job_id'      => $job->id,
            'status'      => $job->status,
            'editable'    => $job->status === 'ready_for_review',
            'target_language' => $job->target_language,
            'source_language' => $job->source_language,
            'duration_seconds' => $job->duration_seconds,
            'segments'    => json_decode($job->segments_json, true) ?? [],
        ]);
    }

    /**
     * PATCH /api/dubbing/{jobId}/segments — save edits made on the review
     * timeline (retimed start/end, rewritten translated text). Only
     * allowed while the job is sitting in 'ready_for_review' — once
     * finalize() has kicked off synthesis, the segments that job reads
     * are whatever was saved last, so editing mid-synthesis would just
     * be silently ignored or (worse) race the running job.
     *
     * 'original' is deliberately NOT accepted from the client — it's
     * always carried over from what's already stored, so a client can't
     * quietly rewrite the transcript record of what was actually said.
     */
    public function updateSegments(Request $request, string $jobId)
    {
        $job = DubbingJob::where('id', $jobId)->where('user_id', $request->user()->id)->first();
        if (! $job) {
            return response()->json(['message' => 'Dubbing job not found.'], 404);
        }
        if ($job->status !== 'ready_for_review') {
            return response()->json(['message' => 'This job is not open for editing right now.', 'status' => $job->status], 409);
        }

        $validated = $request->validate([
            'segments'             => ['required', 'array', 'min:1'],
            'segments.*.id'        => ['required', 'string', 'max:64'],
            'segments.*.start'     => ['required', 'numeric', 'min:0'],
            'segments.*.end'       => ['required', 'numeric', 'gt:segments.*.start'],
            'segments.*.text'      => ['nullable', 'string', 'max:5000'],
        ]);

        $existing = json_decode($job->segments_json ?? '[]', true) ?? [];
        $existingById = collect($existing)->keyBy('id');

        $merged = [];
        foreach ($validated['segments'] as $incoming) {
            $current = $existingById->get($incoming['id']);
            if (! $current) {
                // Client sent an id we never issued — drop it rather than
                // trusting arbitrary client-supplied segments into the
                // pipeline.
                continue;
            }
            $merged[] = [
                'id'       => $current['id'],
                'start'    => round((float) $incoming['start'], 3),
                'end'      => round((float) $incoming['end'], 3),
                'original' => $current['original'], // immutable, see docblock
                'text'     => (string) ($incoming['text'] ?? ''),
            ];
        }

        if (empty($merged)) {
            return response()->json(['message' => 'No valid segments in the request.'], 422);
        }

        usort($merged, fn($a, $b) => $a['start'] <=> $b['start']);

        $job->update(['segments_json' => json_encode($merged)]);

        return response()->json(['message' => 'Saved.', 'segments' => $merged]);
    }

    /** Minimum segment duration allowed — mirrors MIN_SEGMENT_DUR in frontend/src/lib/dubbing.ts. Enforced here too since split creates genuinely new segments the client-side clamps don't otherwise gate. */
    private const MIN_SEGMENT_DUR = 0.3;

    /**
     * POST /api/dubbing/{jobId}/segments/{segmentId}/split — splits one
     * segment into two at a given point in time. Deliberately a separate,
     * narrowly-validated endpoint rather than letting updateSegments()
     * accept unknown ids — that endpoint's whole point is refusing
     * client-fabricated segments; split is the one legitimate way a new
     * segment id can come into existence, so it gets its own explicit,
     * semantically-checked operation instead of a loophole in the general
     * save path.
     *
     * Both halves inherit the SAME original transcript text and the SAME
     * translated text as the segment being split — there's no word-level
     * timing to split the transcript accurately by, so this hands the user
     * a sensible starting point (trim each half's text by hand) rather
     * than guessing at a word boundary or leaving one half blank (which
     * would misleadingly render as "Muted" in the timeline).
     */
    public function splitSegment(Request $request, string $jobId, string $segmentId)
    {
        $job = DubbingJob::where('id', $jobId)->where('user_id', $request->user()->id)->first();
        if (! $job) {
            return response()->json(['message' => 'Dubbing job not found.'], 404);
        }
        if ($job->status !== 'ready_for_review') {
            return response()->json(['message' => 'This job is not open for editing right now.', 'status' => $job->status], 409);
        }

        $validated = $request->validate([
            'split_at' => ['required', 'numeric'],
        ]);
        $splitAt = round((float) $validated['split_at'], 3);

        $segments = json_decode($job->segments_json ?? '[]', true) ?? [];
        $idx = null;
        foreach ($segments as $i => $s) {
            if ($s['id'] === $segmentId) { $idx = $i; break; }
        }
        if ($idx === null) {
            return response()->json(['message' => 'Segment not found.'], 404);
        }

        $seg = $segments[$idx];
        if ($splitAt <= $seg['start'] + self::MIN_SEGMENT_DUR || $splitAt >= $seg['end'] - self::MIN_SEGMENT_DUR) {
            return response()->json([
                'message' => 'Split point is too close to the edge of this segment — each half must be at least '
                    . self::MIN_SEGMENT_DUR . 's long.',
            ], 422);
        }

        $firstHalf  = ['id' => $seg['id'], 'start' => $seg['start'], 'end' => $splitAt, 'original' => $seg['original'], 'text' => $seg['text']];
        $secondHalf = ['id' => (string) Str::uuid(), 'start' => $splitAt, 'end' => $seg['end'], 'original' => $seg['original'], 'text' => $seg['text']];

        array_splice($segments, $idx, 1, [$firstHalf, $secondHalf]);
        usort($segments, fn($a, $b) => $a['start'] <=> $b['start']);

        $job->update(['segments_json' => json_encode($segments)]);

        return response()->json(['message' => 'Split.', 'segments' => $segments]);
    }

    /**
     * POST /api/dubbing/{jobId}/segments/merge — combines two ADJACENT
     * segments into one. Rejects non-adjacent pairs (there's always
     * exactly one sensible merge target for a given segment — "the next
     * one" — reordering isn't a concept this editor supports, so merging
     * across a gap would just be confusing).
     */
    public function mergeSegments(Request $request, string $jobId)
    {
        $job = DubbingJob::where('id', $jobId)->where('user_id', $request->user()->id)->first();
        if (! $job) {
            return response()->json(['message' => 'Dubbing job not found.'], 404);
        }
        if ($job->status !== 'ready_for_review') {
            return response()->json(['message' => 'This job is not open for editing right now.', 'status' => $job->status], 409);
        }

        $validated = $request->validate([
            'first_id'  => ['required', 'string', 'max:64'],
            'second_id' => ['required', 'string', 'max:64'],
        ]);

        $segments = json_decode($job->segments_json ?? '[]', true) ?? [];
        usort($segments, fn($a, $b) => $a['start'] <=> $b['start']);

        $firstIdx = null;
        foreach ($segments as $i => $s) {
            if ($s['id'] === $validated['first_id']) { $firstIdx = $i; break; }
        }
        if ($firstIdx === null || ! isset($segments[$firstIdx + 1]) || $segments[$firstIdx + 1]['id'] !== $validated['second_id']) {
            return response()->json(['message' => 'Those two segments are not adjacent — cannot merge.'], 422);
        }

        $first  = $segments[$firstIdx];
        $second = $segments[$firstIdx + 1];

        $mergedSegment = [
            'id'       => $first['id'],
            'start'    => $first['start'],
            'end'      => $second['end'],
            'original' => trim($first['original'] . ' ' . $second['original']),
            'text'     => trim($first['text'] . ' ' . $second['text']),
        ];

        array_splice($segments, $firstIdx, 2, [$mergedSegment]);

        $job->update(['segments_json' => json_encode($segments)]);

        return response()->json(['message' => 'Merged.', 'segments' => $segments]);
    }

    /**
     * POST /api/dubbing/{jobId}/finalize — commit the currently-saved
     * segments and kick off synthesis + mux. This is the point where
     * synthesis quota actually gets spent (see FinalizeDubbingJob).
     */
    public function finalize(Request $request, string $jobId)
    {
        $job = DubbingJob::where('id', $jobId)->where('user_id', $request->user()->id)->first();
        if (! $job) {
            return response()->json(['message' => 'Dubbing job not found.'], 404);
        }
        if ($job->status !== 'ready_for_review') {
            return response()->json(['message' => 'This job is not ready to finalize.', 'status' => $job->status], 409);
        }
        if (! $job->segments_json) {
            return response()->json(['message' => 'No segments to synthesize.'], 422);
        }

        $job->update(['status' => 'synthesizing', 'progress' => 50, 'error' => null]);
        FinalizeDubbingJob::dispatch($job->id);

        return response()->json(['job_id' => $job->id, 'status' => 'synthesizing']);
    }

    /**
     * GET /api/dubbing — workspace list. Returns every job for the user,
     * most recent first, WITH current status/progress inline. The frontend
     * polls this single endpoint (not per-job /status calls) whenever any
     * job is still in flight, so N running jobs cost one request, not N.
     */
    /**
     * GET /api/dubbing — the workspace's job list.
     *
     * ?video_project_id= (optional, task #15 Phase 1): scopes the list to
     * only the jobs attached to that project's bin (via VideoProjectAsset).
     * Omitted entirely, this returns every job the user has ever
     * submitted, exactly as it always has — kept as the default so nothing
     * calling this endpoint without project context breaks.
     */
    public function index(Request $request)
    {
        $request->validate([
            'video_project_id' => ['nullable', 'uuid'],
        ]);

        $query = DubbingJob::where('user_id', $request->user()->id);

        if ($projectId = $request->query('video_project_id')) {
            $owned = $request->user()->videoProjects()->where('id', $projectId)->exists();
            if (! $owned) {
                return response()->json(['message' => 'Video project not found.'], 404);
            }
            $jobIds = VideoProjectAsset::where('video_project_id', $projectId)
                ->whereNotNull('dubbing_job_id')
                ->pluck('dubbing_job_id');
            $query->whereIn('id', $jobIds);
        }

        $jobs = $query->orderByDesc('created_at')
            ->limit(self::LIST_LIMIT)
            ->get();

        // One extra query to resolve voice-profile names for display,
        // rather than N+1 lookups per row.
        $profileIds = $jobs->pluck('voice_profile_id')->filter(
            fn($id) => $id !== '' && ! str_starts_with($id, 'builtin:')
        )->unique()->values();
        $profileNames = VoiceProfile::where('user_id', $request->user()->id)
            ->whereIn('profile_id', $profileIds)
            ->pluck('name', 'profile_id');

        return response()->json([
            'jobs' => $jobs->map(fn(DubbingJob $j) => [
                'job_id'                 => $j->id,
                'status'                 => $j->status,
                'progress'               => $j->progress,
                'error'                  => $j->error,
                'original_filename'      => $j->original_filename,
                'source_language'        => $j->source_language,
                'target_language'        => $j->target_language,
                'voice_profile_id'       => $j->voice_profile_id,
                'engine'                 => $j->engine,
                'voice_name'             => str_starts_with($j->voice_profile_id, 'builtin:')
                    ? str_replace('builtin:', '', $j->voice_profile_id)
                    : ($profileNames[$j->voice_profile_id] ?? 'Unknown voice'),
                'segment_count'          => $j->segment_count,
                'segment_overflow_count' => $j->segment_overflow_count,
                'duration_seconds'       => $j->duration_seconds,
                'has_source'             => Storage::disk('video')->exists($j->source_video_path),
                'has_result'             => $j->result_video_path && Storage::disk('video')->exists($j->result_video_path),
                'created_at'             => $j->created_at?->toIso8601String(),
            ]),
        ]);
    }

    /** GET /api/dubbing/status/{jobId} — kept for a single-job deep-link/refresh; the workspace list is the primary poll target now. */
    public function status(Request $request, string $jobId)
    {
        $job = DubbingJob::where('id', $jobId)->where('user_id', $request->user()->id)->first();
        if (! $job) {
            return response()->json(['message' => 'Dubbing job not found.'], 404);
        }

        return response()->json([
            'job_id'                 => $job->id,
            'status'                 => $job->status,
            'progress'               => $job->progress,
            'error'                  => $job->error,
            'segment_count'          => $job->segment_count,
            'segment_overflow_count' => $job->segment_overflow_count,
        ]);
    }

    /** GET /api/dubbing/result/{jobId} — returns the dubbed video, or a JSON error/status. */
    public function result(Request $request, string $jobId)
    {
        $job = DubbingJob::where('id', $jobId)->where('user_id', $request->user()->id)->first();
        if (! $job) {
            return response()->json(['message' => 'Dubbing job not found.'], 404);
        }

        if ($job->status === 'failed') {
            return response()->json(['message' => $job->error ?: 'Dubbing failed.'], 422);
        }

        if ($job->status !== 'done' || ! $job->result_video_path) {
            return response()->json(['message' => 'Dubbing not finished yet.', 'status' => $job->status, 'progress' => $job->progress], 409);
        }

        if (! Storage::disk('video')->exists($job->result_video_path)) {
            return response()->json(['message' => 'Result file is missing or has expired.'], 410);
        }

        return $this->streamVideo(Storage::disk('video'), $job->result_video_path, 'dubbed_' . $job->id . '.mp4');
    }

    /**
     * GET /api/dubbing/source/{jobId} — streams the ORIGINAL uploaded video,
     * so the workspace can show a before/after preview rather than only the
     * dubbed result. New in the workspace redesign.
     */
    public function source(Request $request, string $jobId)
    {
        $job = DubbingJob::where('id', $jobId)->where('user_id', $request->user()->id)->first();
        if (! $job) {
            return response()->json(['message' => 'Dubbing job not found.'], 404);
        }

        if (! Storage::disk('video')->exists($job->source_video_path)) {
            return response()->json(['message' => 'Original upload is missing or has expired.'], 410);
        }

        return $this->streamVideo(Storage::disk('video'), $job->source_video_path, 'original_' . $job->id . '.mp4', true);
    }

    /**
     * DELETE /api/dubbing/{jobId} — removes the job row plus both stored
     * video files (source + result, if present). Workspace cleanup: without
     * this, every dub a user runs sits in storage forever with no way to
     * clear it out.
     */
    public function destroy(Request $request, string $jobId)
    {
        $job = DubbingJob::where('id', $jobId)->where('user_id', $request->user()->id)->first();
        if (! $job) {
            return response()->json(['message' => 'Dubbing job not found.'], 404);
        }

        // Refuse to delete out from under an in-flight job — the queue
        // worker has no idea the row/files just vanished and will throw
        // confusing storage errors mid-pipeline instead of a clean failure.
        // 'ready_for_review' is deletable — a job just sitting there
        // waiting on the user isn't "running" in that sense.
        if (! in_array($job->status, ['done', 'failed', 'ready_for_review'], true)) {
            return response()->json(['message' => 'Cannot delete a job that is still running.'], 409);
        }

        foreach ([$job->source_video_path, $job->result_video_path] as $path) {
            if ($path && Storage::disk('video')->exists($path)) {
                Storage::disk('video')->delete($path);
            }
        }

        // Task #15 Phase 1 — known gap, not fixed here: video_project_assets
        // .dubbing_job_id is nullOnDelete (see migration), so deleting a job
        // this way (from the dubbing workspace, independent of any project)
        // leaves its bin asset row behind with dubbing_job_id nulled out and
        // a storage_path pointing at the file just deleted above — an
        // orphaned, effectively-broken bin entry rather than a cleanly
        // removed one. Deliberately not solving this in Phase 1: it needs
        // deciding whether a job can even be deleted independently of its
        // project once Phase 3 makes "dub this bin clip" the normal flow,
        // which is a product question for that phase, not a one-line fix
        // to bolt on here.
        $job->delete();

        return response()->json(['message' => 'Deleted.']);
    }

    /** Shared video-streaming response for result()/source(). */
    private function streamVideo($disk, string $path, string $downloadName, bool $inline = false)
    {
        $stream = $disk->readStream($path);

        return response()->stream(function () use ($stream) {
            fpassthru($stream);
            if (is_resource($stream)) {
                fclose($stream);
            }
        }, 200, [
            'Content-Type'        => 'video/mp4',
            'Content-Disposition' => ($inline ? 'inline' : 'attachment') . '; filename="' . $downloadName . '"',
        ]);
    }
}
