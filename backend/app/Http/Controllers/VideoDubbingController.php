<?php

namespace App\Http\Controllers;

use App\Jobs\VideoDubbingJob;
use App\Models\ActivityLog;
use App\Models\DubbingJob;
use App\Models\VoiceProfile;
use Illuminate\Http\Request;
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
        if (! in_array($job->status, ['done', 'failed'], true)) {
            return response()->json(['message' => 'Cannot delete a job that is still running.'], 409);
        }

        foreach ([$job->source_video_path, $job->result_video_path] as $path) {
            if ($path && Storage::disk('video')->exists($path)) {
                Storage::disk('video')->delete($path);
            }
        }

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
