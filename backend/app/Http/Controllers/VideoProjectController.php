<?php

namespace App\Http\Controllers;

use App\Models\VideoProject;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * Task #15 (Video Studio) Phase 1 — project list/create/rename/delete.
 * See docs/ENHANCEMENT_TASKS.md task #15 for the full phased plan; this
 * controller only covers Phase 1 (the project/asset shell). Phase 2's
 * general multi-type addAsset() upload endpoint, Phase 3's dubClip(),
 * Phase 4's extract/resynthesize endpoints, and Phase 6's render()/
 * outputFile() are NOT here yet — adding them as stubs now would just be
 * dead code to delete or rewrite once those phases are actually designed.
 *
 * Quota gating (project count, asset uploads, renders) is deliberately
 * NOT wired in here yet — see the "Open questions" in task #15: there is
 * no `video_project_limit` key in PlanLimits yet, and calling
 * PlanLimits::limit() with an unknown key silently resolves to "unlimited"
 * (see PlanLimits::limit()'s null-coalesce-to-0-means-unlimited fallback)
 * rather than actually enforcing anything — that would look like
 * enforcement in the code without being real enforcement, which is worse
 * than the honest gap this comment is flagging instead.
 */
class VideoProjectController extends Controller
{
    /** How many projects the list view shows. Small per-user volume expected, same reasoning as VideoDubbingController::LIST_LIMIT. */
    private const LIST_LIMIT = 100;

    /** GET /api/video-projects */
    public function index(Request $request)
    {
        $projects = $request->user()->videoProjects()
            ->withCount('assets')
            ->orderByDesc('updated_at')
            ->limit(self::LIST_LIMIT)
            ->get();

        return response()->json([
            'projects' => $projects->map(fn(VideoProject $p) => $this->summarize($p)),
        ]);
    }

    /** POST /api/video-projects */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => ['nullable', 'string', 'max:255'],
        ]);

        $project = $request->user()->videoProjects()->create([
            'name'          => $validated['name'] ?? 'Untitled project',
            'status'        => 'draft',
            'timeline_json' => [],
        ]);

        return response()->json($this->summarize($project, includeAssets: true));
    }

    /** GET /api/video-projects/{id} — project + its media-bin assets. */
    public function show(Request $request, string $id)
    {
        $project = $request->user()->videoProjects()->with('assets')->find($id);
        if (! $project) {
            return response()->json(['message' => 'Video project not found.'], 404);
        }

        return response()->json($this->summarize($project, includeAssets: true));
    }

    /** PATCH/PUT /api/video-projects/{id} — rename only for now (timeline_json lands in Phase 5). */
    public function update(Request $request, string $id)
    {
        $project = $request->user()->videoProjects()->find($id);
        if (! $project) {
            return response()->json(['message' => 'Video project not found.'], 404);
        }

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
        ]);

        $project->update($validated);

        return response()->json($this->summarize($project, includeAssets: true));
    }

    /**
     * DELETE /api/video-projects/{id} — deletes the project and its
     * video_project_assets rows (cascade, see migration). Deliberately
     * does NOT delete the underlying video_dubbing_jobs rows or their
     * stored files even for assets whose source is 'dubbed' — a dubbing
     * job has its own independent lifecycle (video:prune, the job's own
     * delete endpoint) and this project's asset table is a reference to
     * it, not the owner of it. Same "don't reach into another feature's
     * storage lifecycle" boundary the video:prune command itself respects
     * toward video_project_assets (see PruneVideo's docblock).
     */
    public function destroy(Request $request, string $id)
    {
        $project = $request->user()->videoProjects()->find($id);
        if (! $project) {
            return response()->json(['message' => 'Video project not found.'], 404);
        }

        // Plain (non-dubbing-job-backed) uploads store their own file
        // independent of any other table — those must be cleaned up here,
        // since nothing else owns their lifecycle.
        foreach ($project->assets()->whereNull('dubbing_job_id')->whereNotNull('storage_path')->get() as $asset) {
            try {
                Storage::disk('video')->delete($asset->storage_path);
            } catch (\Throwable) {
                // Missing/unreachable file must not block the project delete.
            }
        }

        $project->delete();

        return response()->json(null, 204);
    }

    private function summarize(VideoProject $p, bool $includeAssets = false): array
    {
        $out = [
            'id'                => $p->id,
            'name'              => $p->name,
            'status'            => $p->status,
            'error'             => $p->error,
            'duration_seconds'  => $p->duration_seconds,
            'has_output'        => (bool) ($p->output_video_path && Storage::disk('video')->exists($p->output_video_path)),
            'asset_count'       => $p->asset_count ?? $p->assets()->count(),
            'created_at'        => $p->created_at?->toIso8601String(),
            'updated_at'        => $p->updated_at?->toIso8601String(),
        ];

        if ($includeAssets) {
            $out['assets'] = $p->assets->map(fn($a) => [
                'id'                 => $a->id,
                'kind'               => $a->kind,
                'source'             => $a->source,
                'parent_asset_id'    => $a->parent_asset_id,
                'dubbing_job_id'     => $a->dubbing_job_id,
                'original_filename'  => $a->original_filename,
                'duration_seconds'   => $a->duration_seconds,
                'status'             => $a->status,
                'created_at'         => $a->created_at?->toIso8601String(),
            ]);
        }

        return $out;
    }
}
