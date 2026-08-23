<?php

namespace App\Http\Controllers;

use App\Jobs\PrepareDubbingJob;
use App\Models\ActivityLog;
use App\Models\DubbingJob;
use App\Models\VideoProject;
use App\Models\VideoProjectClip;
use App\Models\VoiceProfile;
use App\Services\EngineResolver;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Task #6a (Video Studio).
 *
 * Phase 1 (Aug 23, 2026) — video_projects CRUD and the media-bin upload
 * flow. Deliberately mirrors ProjectController's shape (the audio-
 * workspace equivalent) and VideoDubbingController::submit()'s upload
 * handling (same 200MB cap, same mimetypes, same 'video' disk).
 *
 * Phase 2 (Aug 23, 2026) — dubClip(): "Dub this clip" wires an existing
 * bin item into the *existing, unmodified* dubbing pipeline
 * (DubbingJob → PrepareDubbingJob → the review timeline →
 * FinalizeDubbingJob), exactly the way VideoDubbingController::submit()/
 * retry() already do it, and links the result back as a `dubbed`
 * variant clip in the same bin. No changes to DubbingJob, PrepareDubbingJob,
 * FinalizeDubbingJob, or the segment-review endpoints were needed or made.
 *
 * Phase 3 (Aug 23, 2026) — clipFile(): streams a bin clip's own video file
 * (source OR dubbed) so the studio UI can preview clips and play back the
 * composed timeline. Nothing else changed on the backend this phase — the
 * timeline itself is just `timeline_json` (an ordered array of
 * {clip_id, trim_in, trim_out, variant}), already scaffolded in Phase 1's
 * `update()`, since the flat ordered-list shape already satisfies "compose
 * chosen clips/variants into one deliverable" without inventing a new
 * schema for a visual multi-lane layout that Phase 4's render job would
 * just flatten back into a sequence anyway.
 *
 * NOT yet wired (see docs/ENHANCEMENT_TASKS.md task #6a):
 *  - PlanLimits quota check on project count — project_limit is
 *    DB-seeded per plan (plan_limits table) and adding a
 *    video_project_limit key means a seed/migration decision that
 *    belongs to product, not something to guess a number for here.
 *  - Render/export (Phase 4) — timeline_json is composed and saved, but
 *    nothing consumes it into an actual output video file yet.
 */
class VideoProjectController extends Controller
{
    /** Same cap as VideoDubbingController::MAX_UPLOAD_KB — video is the heaviest upload type in this app. */
    private const MAX_UPLOAD_KB = 204800;

    /**
     * GET /api/video-projects
     */
    public function index(Request $request)
    {
        return response()->json(
            $request->user()->videoProjects()->withCount('clips')->latest()->get()
        );
    }

    /**
     * POST /api/video-projects
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => 'nullable|string|max:255',
        ]);

        $project = $request->user()->videoProjects()->create([
            'id'     => (string) Str::uuid(),
            'name'   => $validated['name'] ?? 'Untitled video',
            'status' => 'draft',
        ]);

        return response()->json($project);
    }

    /**
     * GET /api/video-projects/{id} — includes the media bin. Any
     * 'dubbed' clip still marked 'processing' gets its status refreshed
     * against its linked DubbingJob first (see syncDubbedClipStatuses) —
     * cheap self-healing sync instead of a webhook/callback from
     * FinalizeDubbingJob, since this endpoint is already polled whenever
     * the studio page is open.
     */
    public function show(Request $request, string $id)
    {
        $project = $request->user()->videoProjects()->with('clips')->findOrFail($id);

        $this->syncDubbedClipStatuses($project);

        return response()->json($project);
    }

    /**
     * PATCH /api/video-projects/{id} — rename, or save timeline_json
     * (the studio autosaves the timeline here, same role
     * `ProjectController::update`'s `timeline_clips` plays for Assembly).
     */
    public function update(Request $request, string $id)
    {
        $project = $request->user()->videoProjects()->findOrFail($id);

        $validated = $request->validate([
            'name'          => 'nullable|string|max:255',
            'timeline_json' => 'nullable|array',
        ]);

        $project->update($validated);

        return response()->json($project);
    }

    /**
     * DELETE /api/video-projects/{id}
     */
    public function destroy(Request $request, string $id)
    {
        $project = $request->user()->videoProjects()->with('clips')->findOrFail($id);

        foreach ($project->clips as $clip) {
            if ($clip->storage_path) {
                try {
                    Storage::disk('video')->delete($clip->storage_path);
                } catch (\Throwable) {
                    // Missing/unreachable file must not block the project delete
                }
            }
        }

        $project->delete();

        return response()->json(null, 204);
    }

    /**
     * POST /api/video-projects/{id}/clips — add one file to the media bin.
     * multipart: video (file)
     *
     * Deliberately one-file-per-request (not a batch endpoint): the
     * reference UI uploads via "+ Add files" / drag-drop, which the
     * frontend can just loop over per-file, and keeps failure handling
     * (one bad file in a batch of five) simple on both ends.
     */
    public function addClip(Request $request, string $id)
    {
        $user = $request->user();
        $project = $user->videoProjects()->findOrFail($id);

        $validated = $request->validate([
            'video' => ['required', 'file', 'mimetypes:video/mp4,video/quicktime,video/x-matroska,video/webm', 'max:' . self::MAX_UPLOAD_KB],
        ]);

        $clipId = (string) Str::uuid();
        $storedPath = 'video/' . $user->id . '/projects/' . $project->id . '/' . $clipId . '.mp4';

        $realPath = $validated['video']->getRealPath();
        Storage::disk('video')->put($storedPath, file_get_contents($realPath));

        $clip = VideoProjectClip::create([
            'id'                 => $clipId,
            'video_project_id'   => $project->id,
            'kind'               => 'source',
            'original_filename'  => $validated['video']->getClientOriginalName(),
            'storage_path'       => $storedPath,
            'duration_seconds'   => $this->probeDuration($realPath),
            'status'             => 'ready',
        ]);

        return response()->json($clip);
    }

    /**
     * DELETE /api/video-projects/{id}/clips/{clipId} — remove one bin
     * item. Refuses if it's still referenced in timeline_json so a user
     * can't silently break a saved timeline; frontend should prompt to
     * remove it from the timeline first. Also refuses while a dub is
     * still processing on it (matches destroy()'s "can't delete a
     * running dubbing job" rule in VideoDubbingController) — deleting a
     * dubbed-variant *placeholder* clip out from under an in-flight
     * DubbingJob would just leave an orphaned job with nowhere to land.
     */
    public function destroyClip(Request $request, string $id, string $clipId)
    {
        $project = $request->user()->videoProjects()->findOrFail($id);
        $clip = $project->clips()->findOrFail($clipId);

        $onTimeline = collect($project->timeline_json ?? [])
            ->contains(fn ($entry) => ($entry['clip_id'] ?? null) === $clip->id);

        if ($onTimeline) {
            return response()->json([
                'message' => 'This clip is still on the timeline — remove it there first.',
                'code'    => 'clip_in_use',
            ], 422);
        }

        if ($clip->kind === 'dubbed' && $clip->status === 'processing') {
            return response()->json([
                'message' => 'This dub is still processing — wait for it to finish before removing it.',
                'code'    => 'dub_in_progress',
            ], 409);
        }

        if ($clip->storage_path) {
            try {
                Storage::disk('video')->delete($clip->storage_path);
            } catch (\Throwable) {
                // Missing/unreachable file must not block the clip delete
            }
        }

        $clip->delete();

        return response()->json(null, 204);
    }

    /**
     * POST /api/video-projects/{id}/clips/{clipId}/dub — Phase 2:
     * "Dub this clip". Takes a `source` bin clip, kicks off a DubbingJob
     * on a copy of its file (exact same copy-not-point-at pattern
     * VideoDubbingController::retry() uses, so the two jobs' file
     * lifecycles stay independent), and immediately creates the
     * `dubbed`-kind placeholder clip in the bin pointing at that job.
     *
     * The placeholder starts life with no storage_path/duration and
     * status='processing' — show()'s syncDubbedClipStatuses() fills
     * those in once the job reaches 'done' (or flips status to 'failed'
     * if the job fails). The frontend should route the user into the
     * *existing* review-timeline UI (DubbingTimelineEditor) using the
     * returned job_id — that whole flow (segments/updateSegments/
     * finalize) is reused completely unchanged.
     */
    public function dubClip(Request $request, string $id, string $clipId)
    {
        $user = $request->user();
        $project = $user->videoProjects()->findOrFail($id);
        $sourceClip = $project->clips()->findOrFail($clipId);

        if ($sourceClip->kind !== 'source') {
            return response()->json([
                'message' => 'Only an originally-uploaded clip can be dubbed — pick a source clip, not a dubbed variant.',
                'code'    => 'not_a_source_clip',
            ], 422);
        }

        if (! $sourceClip->storage_path || ! Storage::disk('video')->exists($sourceClip->storage_path)) {
            return response()->json(['message' => 'This clip\'s video file is missing or has expired.'], 410);
        }

        $validated = $request->validate([
            'target_language'  => ['required', 'string', 'max:10'],
            'source_language'  => ['nullable', 'string', 'max:10'],
            'voice_profile_id' => ['required', 'string', 'max:100'],
            'engine'           => ['nullable', 'string', EngineResolver::engineValidationRule()],
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

        // Same copy-into-a-new-job-scoped-key pattern as
        // VideoDubbingController::retry() — the DubbingJob owns its own
        // independent copy of the file, never a pointer back into the
        // project's media bin storage.
        $jobId = (string) Str::uuid();
        $jobStoredPath = 'video/' . $user->id . '/' . $jobId . '_source.mp4';
        Storage::disk('video')->copy($sourceClip->storage_path, $jobStoredPath);

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
            'original_filename' => $sourceClip->original_filename,
            'status'            => 'queued',
            'progress'          => 0,
            'source_video_path' => $jobStoredPath,
        ]);

        PrepareDubbingJob::dispatch($job->id);

        $dubbedClip = VideoProjectClip::create([
            'id'                => (string) Str::uuid(),
            'video_project_id'  => $project->id,
            'kind'              => 'dubbed',
            'parent_clip_id'    => $sourceClip->id,
            'dubbing_job_id'    => $job->id,
            'original_filename' => $sourceClip->original_filename,
            'storage_path'      => null,
            'duration_seconds'  => null,
            'status'            => 'processing',
        ]);

        return response()->json([
            'clip'   => $dubbedClip,
            'job_id' => $job->id,
            'status' => 'queued',
        ]);
    }

    /**
     * GET /api/video-projects/{id}/clips/{clipId}/file — streams a bin
     * clip's own video file (whichever `storage_path` it currently has,
     * source or dubbed). Phase 3: the studio UI needs this both for the
     * media-bin preview player and for playing back timeline entries;
     * neither existed as a fetchable resource before this phase since
     * Phase 1/2 only ever wrote clip files, never served them back.
     * Same inline-stream pattern as VideoDubbingController::source()/
     * result() (duplicated rather than shared for now — see
     * probeDuration()'s docblock below for the same "third caller"
     * promotion note, which this now nudges closer to true).
     */
    public function clipFile(Request $request, string $id, string $clipId)
    {
        $project = $request->user()->videoProjects()->findOrFail($id);
        $clip = $project->clips()->findOrFail($clipId);

        if (! $clip->storage_path || ! Storage::disk('video')->exists($clip->storage_path)) {
            return response()->json(['message' => 'This clip\'s video file is missing or has expired.'], 410);
        }

        return $this->streamVideo(Storage::disk('video'), $clip->storage_path, ($clip->original_filename ?: $clip->id) . '.mp4');
    }

    /**
     * Refreshes every 'processing' dubbed-variant clip on this project
     * against its linked DubbingJob. Called from show() rather than run
     * as a queued callback — keeps FinalizeDubbingJob completely
     * unmodified, at the cost of only updating on next fetch (acceptable:
     * the review-timeline UI the user is actually watching already polls
     * the DubbingJob directly for live progress).
     */
    private function syncDubbedClipStatuses(VideoProject $project): void
    {
        foreach ($project->clips as $clip) {
            if ($clip->kind !== 'dubbed' || $clip->status !== 'processing') {
                continue;
            }

            $job = $clip->dubbingJob;
            if (! $job) {
                continue;
            }

            if ($job->status === 'done' && $job->result_video_path) {
                $clip->update([
                    'storage_path'     => $job->result_video_path,
                    'duration_seconds' => $job->duration_seconds,
                    'status'           => 'ready',
                ]);
            } elseif ($job->status === 'failed') {
                $clip->update(['status' => 'failed']);
            }
            // Any other job status (queued/transcribing/translating/
            // ready_for_review/synthesizing/muxing) — still in flight,
            // clip stays 'processing'. 'ready_for_review' in particular
            // means the job is waiting on the user in the review
            // timeline, not stuck; nothing to sync yet either way.
        }
    }

    /**
     * Same ffprobe pattern as DubbingPipelineHelpers::probeDuration —
     * duplicated rather than shared because that one's private to a job
     * trait; worth promoting to a shared Service if a third caller shows up.
     */
    private function probeDuration(string $path): ?float
    {
        $proc = proc_open(
            ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', $path],
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes
        );
        if (! is_resource($proc)) {
            return null;
        }
        $out = stream_get_contents($pipes[1]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($proc);

        $val = trim($out);
        return is_numeric($val) ? round((float) $val, 3) : null;
    }

    /**
     * Same streaming pattern as VideoDubbingController::streamVideo() —
     * duplicated for the same reason probeDuration() above is: it's
     * private to that controller. This is now the second copy of this
     * exact method (probeDuration's docblock flagged a "third caller"
     * threshold for promoting to a shared Service — worth doing either of
     * these next time a third one shows up).
     */
    private function streamVideo($disk, string $path, string $downloadName)
    {
        $stream = $disk->readStream($path);

        return response()->stream(function () use ($stream) {
            fpassthru($stream);
            if (is_resource($stream)) {
                fclose($stream);
            }
        }, 200, [
            'Content-Type'        => 'video/mp4',
            'Content-Disposition' => 'inline; filename="' . $downloadName . '"',
        ]);
    }
}
