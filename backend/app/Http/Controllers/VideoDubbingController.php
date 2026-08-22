<?php

namespace App\Http\Controllers;

use App\Jobs\VideoDubbingJob;
use App\Models\ActivityLog;
use App\Models\DubbingJob;
use App\Models\DubbingSegment;
use App\Models\VoiceProfile;
use App\Services\DubbingAudio;
use App\Services\EngineResolver;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Task #6 (Video dubbing MVP), evolved into a proper workspace: list/delete
 * added alongside the original submit/status/result so the frontend can
 * show upload history, support several jobs in flight at once, and let
 * people manage (and clean up) their dubs — not just fire-and-forget one
 * at a time. Still thin — all pipeline logic stays in VideoDubbingJob.
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
            // (see useTTSEngine.ts) — nullable so VideoDubbingJob can fall
            // back to a sane default if an older client omits it.
            'engine'            => ['nullable', 'string', EngineResolver::engineValidationRule()],
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

        VideoDubbingJob::dispatch($job->id);

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

        VideoDubbingJob::dispatch($job->id);

        return response()->json([
            'job_id'          => $job->id,
            'status'          => 'queued',
            'activity_log_id' => $log->id,
        ]);
    }

    /**
     * GET /api/dubbing — workspace list. Returns every job for the user,
     * most recent first, WITH current status/progress inline. The frontend
     * polls this single endpoint (not per-job /status calls) whenever any
     * job is still in flight, so N running jobs cost one request, not N.
     */
    public function index(Request $request)
    {
        $jobs = DubbingJob::where('user_id', $request->user()->id)
            ->orderByDesc('created_at')
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
     * GET /api/dubbing/{jobId}/segments — Tier 1 advanced dubbing. Lists
     * every persisted segment for a job: original + translated text,
     * timing, fit/status outcome, mute flag, and any per-segment voice
     * override — the data VideoDubbingJob now saves per segment instead
     * of discarding once the job finishes (see the dubbing_segments
     * migration and VideoDubbingJob::persistSegment()).
     */
    public function segments(Request $request, string $jobId)
    {
        $job = DubbingJob::where('id', $jobId)->where('user_id', $request->user()->id)->first();
        if (! $job) {
            return response()->json(['message' => 'Dubbing job not found.'], 404);
        }

        $segments = DubbingSegment::where('dubbing_job_id', $job->id)
            ->orderBy('segment_index')
            ->get();

        return response()->json([
            'segments' => $segments->map(fn(DubbingSegment $s) => $this->segmentJson($s)),
        ]);
    }

    /**
     * PATCH /api/dubbing/{jobId}/segments/{segmentId} — edit a segment's
     * translated text, mute flag, or per-segment voice override. This
     * only updates the stored row; the segment's own audio isn't
     * re-synthesized until resynthesizeSegment() is called for it, and
     * the combined video isn't updated until remux() is called for the
     * job — editing several segments and applying them all in one remux
     * is the expected flow, not a resynthesize-then-remux round trip per
     * edit.
     */
    public function updateSegment(Request $request, string $jobId, int $segmentId)
    {
        $job = DubbingJob::where('id', $jobId)->where('user_id', $request->user()->id)->first();
        if (! $job) {
            return response()->json(['message' => 'Dubbing job not found.'], 404);
        }
        $segment = DubbingSegment::where('id', $segmentId)->where('dubbing_job_id', $job->id)->first();
        if (! $segment) {
            return response()->json(['message' => 'Segment not found.'], 404);
        }

        $validated = $request->validate([
            'translated_text'  => ['sometimes', 'string', 'max:2000'],
            'muted'            => ['sometimes', 'boolean'],
            'voice_profile_id' => ['sometimes', 'nullable', 'string', 'max:100'],
        ]);

        if (array_key_exists('voice_profile_id', $validated) && $validated['voice_profile_id']) {
            $profileId = $validated['voice_profile_id'];
            if (! str_starts_with($profileId, 'builtin:')) {
                $owned = VoiceProfile::where('user_id', $request->user()->id)
                    ->where('profile_id', $profileId)
                    ->exists();
                if (! $owned) {
                    return response()->json(['message' => 'Voice profile not found on your account.'], 422);
                }
            }
        }

        $segment->update($validated);

        return response()->json(['segment' => $this->segmentJson($segment->fresh())]);
    }

    /**
     * POST /api/dubbing/{jobId}/segments/{segmentId}/resynthesize —
     * re-run just this segment's synthesis + fit-to-window using its
     * current (possibly just-edited) translated text, mute flag, and
     * voice override, replacing its stored audio. Uses the exact same
     * fit-or-leave-natural decision VideoDubbingJob's main loop makes
     * (App\Services\DubbingAudio::MAX_STRETCH_RATIO), simplified in one
     * intentional way: the whole-job drift-recovery squeeze (opportunistic
     * extra compression to pay down an earlier segment's overflow) is a
     * sequential, whole-job concept that doesn't map onto redoing one
     * segment in isolation after the fact — this always fits the segment
     * to its own window alone.
     *
     * Does NOT touch the job's combined result video — call remux() for
     * that once you're done editing/resynthesizing whichever segments
     * needed it.
     */
    public function resynthesizeSegment(Request $request, string $jobId, int $segmentId)
    {
        $job = DubbingJob::where('id', $jobId)->where('user_id', $request->user()->id)->first();
        if (! $job) {
            return response()->json(['message' => 'Dubbing job not found.'], 404);
        }
        $segment = DubbingSegment::where('id', $segmentId)->where('dubbing_job_id', $job->id)->first();
        if (! $segment) {
            return response()->json(['message' => 'Segment not found.'], 404);
        }

        $windowSeconds = max(0.1, $segment->end_time - $segment->start_time);
        $path = 'video/' . $job->user_id . '/' . $job->id . '/seg_' . $segment->segment_index . '.wav';

        try {
            if ($segment->muted) {
                $audio = DubbingAudio::generateSilenceWav($windowSeconds, DubbingAudio::SAMPLE_RATE);
                $status = 'ok';
                $ratio  = 1.0;
            } else {
                $engineUrl = rtrim(EngineResolver::activeUrl(), '/');
                $profileId = $segment->voice_profile_id ?: $job->voice_profile_id;
                $engineKey = $this->resolveEngineKeyForResynth($job->user_id, $profileId);
                $ttsEngine = $job->engine ?: 'xtts';

                $rawWav = DubbingAudio::synthesizeSegment(
                    $engineUrl, $segment->translated_text, $engineKey, $job->target_language, $ttsEngine
                );

                $tmpDir = sys_get_temp_dir() . '/dub_resynth_' . $segment->id;
                @mkdir($tmpDir, 0700, true);
                $rawPath = $tmpDir . '/raw.wav';
                file_put_contents($rawPath, $rawWav);

                $normPath = $tmpDir . '/norm.wav';
                DubbingAudio::runFfmpeg([
                    'ffmpeg', '-y', '-i', $rawPath,
                    '-af', 'highpass=f=80,loudnorm=I=-16:LRA=11:TP=-1.5',
                    '-map_metadata', '-1', '-ar', (string) DubbingAudio::SAMPLE_RATE, '-ac', '1',
                    '-f', 'wav', '-acodec', 'pcm_s16le', $normPath,
                ], 'Segment loudness normalization');

                $actualDuration = DubbingAudio::probeDuration($normPath) ?: DubbingAudio::estimateWavDuration($rawWav, DubbingAudio::SAMPLE_RATE);
                $fitRatio = $actualDuration > 0 ? $actualDuration / $windowSeconds : 1.0;

                if ($fitRatio > 1.0 && $fitRatio <= DubbingAudio::MAX_STRETCH_RATIO) {
                    $fitPath = $tmpDir . '/fit.wav';
                    DubbingAudio::runFfmpeg([
                        'ffmpeg', '-y', '-i', $normPath,
                        '-af', 'atempo=' . round($fitRatio, 4),
                        '-map_metadata', '-1', '-ar', (string) DubbingAudio::SAMPLE_RATE, '-ac', '1',
                        '-f', 'wav', '-acodec', 'pcm_s16le', $fitPath,
                    ], 'Segment time-fit');
                    $audio  = file_get_contents($fitPath);
                    $status = 'ok';
                    $ratio  = round($fitRatio, 4);
                } elseif ($fitRatio > DubbingAudio::MAX_STRETCH_RATIO) {
                    $audio  = file_get_contents($normPath);
                    $status = 'overflow';
                    $ratio  = round($fitRatio, 4);
                } else {
                    $audio  = file_get_contents($normPath);
                    $status = 'ok';
                    $ratio  = 1.0;
                }

                $this->rrmdirLocal($tmpDir);
            }
        } catch (\Throwable $e) {
            Log::warning("VideoDubbingController::resynthesizeSegment {$segment->id} failed: {$e->getMessage()}");
            return response()->json(['message' => 'Resynthesis failed: ' . $e->getMessage()], 422);
        }

        Storage::disk('video')->put($path, $audio);
        $segment->update(['status' => $status, 'stretch_ratio' => $ratio, 'audio_path' => $path]);

        return response()->json(['segment' => $this->segmentJson($segment->fresh())]);
    }

    /**
     * POST /api/dubbing/{jobId}/remux — rebuild the combined dubbed video
     * from the CURRENT state of every persisted segment (respecting any
     * text edits, mutes, voice overrides, or individual resynthesis
     * already applied), without re-running transcription, translation, or
     * whole-job synthesis. This is the "apply my changes" action after
     * using the segment editor — and doubles as a recovery path if the
     * final mux step itself ever fails again for some new reason: as long
     * as segments were already synthesized, remuxing doesn't require
     * redoing any of that expensive work.
     */
    public function remux(Request $request, string $jobId)
    {
        $job = DubbingJob::where('id', $jobId)->where('user_id', $request->user()->id)->first();
        if (! $job) {
            return response()->json(['message' => 'Dubbing job not found.'], 404);
        }
        if (! Storage::disk('video')->exists($job->source_video_path)) {
            return response()->json(['message' => 'Original upload is no longer available — cannot remux.'], 410);
        }

        $segments = DubbingSegment::where('dubbing_job_id', $job->id)->orderBy('segment_index')->get();
        if ($segments->isEmpty()) {
            return response()->json(['message' => 'No segments to remux — this job has no per-segment data (dubbed before the advanced editor existed). Use Retry instead.'], 422);
        }

        $tmpDir = sys_get_temp_dir() . '/dub_remux_' . $job->id;
        @mkdir($tmpDir, 0700, true);

        try {
            $videoPath = $tmpDir . '/source.mp4';
            $sourceStream = Storage::disk('video')->readStream($job->source_video_path);
            if (! $sourceStream) {
                throw new \RuntimeException('Could not read the original uploaded video from storage.');
            }
            file_put_contents($videoPath, stream_get_contents($sourceStream));
            fclose($sourceStream);

            $pieces = [];
            $cursor = 0.0;
            foreach ($segments as $segment) {
                $windowSeconds = max(0.1, $segment->end_time - $segment->start_time);

                if ($cursor < $segment->start_time) {
                    $pieces[] = DubbingAudio::generateSilenceWav($segment->start_time - $cursor, DubbingAudio::SAMPLE_RATE);
                    $cursor = $segment->start_time;
                }

                if ($segment->muted) {
                    // Respect the CURRENT mute flag even if this segment's
                    // stored audio is real speech from before it was muted.
                    $piece = DubbingAudio::generateSilenceWav($windowSeconds, DubbingAudio::SAMPLE_RATE);
                } elseif ($segment->audio_path && Storage::disk('video')->exists($segment->audio_path)) {
                    $piece = Storage::disk('video')->get($segment->audio_path);
                } else {
                    // No stored audio for this segment (shouldn't normally
                    // happen) — silence rather than failing the whole remux.
                    $piece = DubbingAudio::generateSilenceWav($windowSeconds, DubbingAudio::SAMPLE_RATE);
                }

                $pieces[] = $piece;
                $cursor  += DubbingAudio::estimateWavDuration($piece, DubbingAudio::SAMPLE_RATE);
            }

            $dubbedTrack = DubbingAudio::spliceWavs($pieces, DubbingAudio::SAMPLE_RATE);
            $dubbedTrackPath = $tmpDir . '/dubbed_track.wav';
            file_put_contents($dubbedTrackPath, $dubbedTrack);

            $outputPath = $tmpDir . '/output.mp4';
            DubbingAudio::runFfmpeg([
                'ffmpeg', '-y',
                '-i', $videoPath,
                '-i', $dubbedTrackPath,
                '-map', '0:v:0', '-map', '1:a:0',
                '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
                $outputPath,
            ], 'Final mux');

            $resultPath = 'video/' . $job->user_id . '/' . $job->id . '.mp4';
            Storage::disk('video')->put($resultPath, file_get_contents($outputPath));

            $job->update([
                'status'            => 'done',
                'progress'          => 100,
                'result_video_path' => $resultPath,
                'duration_seconds'  => DubbingAudio::probeDuration($videoPath) ?: $cursor,
                'error'             => null,
                'ended_at'          => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning("VideoDubbingController::remux {$job->id} failed: {$e->getMessage()}");
            return response()->json(['message' => 'Remux failed: ' . $e->getMessage()], 422);
        } finally {
            $this->rrmdirLocal($tmpDir);
        }

        return response()->json(['message' => 'Remuxed.', 'job_id' => $job->id, 'status' => 'done']);
    }

    /**
     * GET /api/dubbing/{jobId}/segments/{segmentId}/audio — a single
     * segment's own stored audio, for solo preview/review in the advanced
     * editor without needing to play the whole combined track.
     */
    public function segmentAudio(Request $request, string $jobId, int $segmentId)
    {
        $job = DubbingJob::where('id', $jobId)->where('user_id', $request->user()->id)->first();
        if (! $job) {
            return response()->json(['message' => 'Dubbing job not found.'], 404);
        }
        $segment = DubbingSegment::where('id', $segmentId)->where('dubbing_job_id', $job->id)->first();
        if (! $segment || ! $segment->audio_path || ! Storage::disk('video')->exists($segment->audio_path)) {
            return response()->json(['message' => 'Segment audio not found.'], 404);
        }

        return response(Storage::disk('video')->get($segment->audio_path), 200, [
            'Content-Type' => 'audio/wav',
        ]);
    }

    private function segmentJson(DubbingSegment $s): array
    {
        return [
            'id'               => $s->id,
            'segment_index'    => $s->segment_index,
            'start_time'       => $s->start_time,
            'end_time'         => $s->end_time,
            'original_text'    => $s->original_text,
            'translated_text'  => $s->translated_text,
            'voice_profile_id' => $s->voice_profile_id,
            'muted'            => $s->muted,
            'status'           => $s->status,
            'stretch_ratio'    => $s->stretch_ratio,
            'has_audio'        => (bool) ($s->audio_path && Storage::disk('video')->exists($s->audio_path)),
        ];
    }

    /** Same voice-profile → engine-key resolution VideoDubbingJob uses, for standalone segment resynthesis. */
    private function resolveEngineKeyForResynth(int $userId, string $profileId): string
    {
        if ($profileId === '' || str_starts_with($profileId, 'builtin:')) {
            return $profileId;
        }
        $profile = VoiceProfile::where('user_id', $userId)
            ->where('profile_id', $profileId)
            ->first();
        return $profile?->engine_key ?: $profileId;
    }

    private function rrmdirLocal(string $dir): void
    {
        if (! is_dir($dir)) {
            return;
        }
        foreach (scandir($dir) ?: [] as $f) {
            if ($f === '.' || $f === '..') continue;
            $path = "{$dir}/{$f}";
            is_dir($path) ? $this->rrmdirLocal($path) : @unlink($path);
        }
        @rmdir($dir);
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
        if (! in_array($job->status, ['done', 'failed'], true)) {
            return response()->json(['message' => 'Cannot delete a job that is still running.'], 409);
        }

        foreach ([$job->source_video_path, $job->result_video_path] as $path) {
            if ($path && Storage::disk('video')->exists($path)) {
                Storage::disk('video')->delete($path);
            }
        }
        // Per-segment audio (Tier 1 advanced dubbing) lives in its own
        // job-scoped directory rather than loose top-level keys — deleting
        // the whole prefix is simpler and safer than tracking every
        // segment's individual path here. The DubbingSegment rows
        // themselves are handled by the table's cascadeOnDelete FK.
        Storage::disk('video')->deleteDirectory('video/' . $job->user_id . '/' . $job->id);

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
