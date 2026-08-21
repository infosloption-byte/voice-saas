<?php

namespace App\Http\Controllers;

use App\Jobs\VideoDubbingJob;
use App\Models\ActivityLog;
use App\Models\DubbingJob;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Task #6 (Video dubbing MVP). Thin controller — same shape as
 * EngineSynthesisProxyController::queueBulk/status/result: validate,
 * persist a job row, dispatch the queue worker, and let the frontend poll.
 * All the real pipeline logic lives in App\Jobs\VideoDubbingJob.
 */
class VideoDubbingController extends Controller
{
    /** Max upload size in KB (200MB) — video is heavier than any other upload in this app. */
    private const MAX_UPLOAD_KB = 204800;

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
        ]);

        // Ownership check for real (non-builtin) voice profiles, same pattern
        // BulkSynthesisJob's queueBulk uses for scripts belonging to a project.
        $profileId = $validated['voice_profile_id'];
        if ($profileId !== '' && ! str_starts_with($profileId, 'builtin:')) {
            $owned = \App\Models\VoiceProfile::where('user_id', $user->id)
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
            'source_language'   => $validated['source_language'] ?? null,
            'target_language'   => $validated['target_language'],
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

    /** GET /api/dubbing/status/{jobId} */
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

    /** GET /api/dubbing/result/{jobId} — returns the video, or a JSON error/status. */
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

        $stream = Storage::disk('video')->readStream($job->result_video_path);

        return response()->stream(function () use ($stream) {
            fpassthru($stream);
            if (is_resource($stream)) {
                fclose($stream);
            }
        }, 200, [
            'Content-Type'        => 'video/mp4',
            'Content-Disposition' => 'attachment; filename="dubbed_' . $job->id . '.mp4"',
        ]);
    }
}
