<?php

namespace App\Http\Controllers;

use App\Models\VideoProject;
use App\Models\VideoProjectClip;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Task #6a (Video Studio), Phase 1 — video_projects CRUD and the
 * media-bin upload flow. Deliberately mirrors ProjectController's shape
 * (the audio-workspace equivalent) and VideoDubbingController::submit()'s
 * upload handling (same 200MB cap, same mimetypes, same 'video' disk).
 *
 * NOT yet wired in this phase (see docs/ENHANCEMENT_TASKS.md task #6a):
 *  - PlanLimits quota check on project count — project_limit is
 *    DB-seeded per plan (plan_limits table) and adding a
 *    video_project_limit key means a seed/migration decision that
 *    belongs to product, not something to guess a number for here.
 *  - "Dub this clip" endpoint (Phase 2) — will live here or in
 *    VideoDubbingController, TBD when that phase starts; it reuses
 *    DubbingJob/PrepareDubbingJob unchanged.
 *  - Render/export endpoint (Phase 4).
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
     * GET /api/video-projects/{id} — includes the media bin.
     */
    public function show(Request $request, string $id)
    {
        $project = $request->user()->videoProjects()->with('clips')->findOrFail($id);

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
            try {
                Storage::disk('video')->delete($clip->storage_path);
            } catch (\Throwable) {
                // Missing/unreachable file must not block the project delete
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
     * remove it from the timeline first.
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

        try {
            Storage::disk('video')->delete($clip->storage_path);
        } catch (\Throwable) {
            // Missing/unreachable file must not block the clip delete
        }

        $clip->delete();

        return response()->json(null, 204);
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
}
