<?php

namespace App\Http\Controllers;

use App\Jobs\Concerns\DubbingPipelineHelpers;
use App\Models\VideoProject;
use App\Models\VideoProjectAsset;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Task #15 (Video Studio) Phase 1 + Phase 2. See
 * docs/ENHANCEMENT_TASKS.md task #15 for the full phased plan. Phase 3's
 * dubClip(), Phase 4's extract/resynthesize endpoints, and Phase 6's
 * render()/outputFile() are NOT here yet — adding them as stubs now would
 * just be dead code to delete or rewrite once those phases are actually
 * designed.
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
    // probeDuration()/runFfmpeg() etc — Phase 2 only needs probeDuration()
    // here, but the trait's other methods being unused in this class is
    // harmless (same reasoning FinalizeDubbingJob/PrepareDubbingJob already
    // share this trait for their own non-overlapping subsets of it).
    use DubbingPipelineHelpers;

    /** How many projects the list view shows. Small per-user volume expected, same reasoning as VideoDubbingController::LIST_LIMIT. */
    private const LIST_LIMIT = 100;

    /**
     * Shared upload ceiling for bin assets, same 200MB figure
     * VideoDubbingController::MAX_UPLOAD_KB already uses for a dub
     * submission's source video — not split per-kind (video/audio/image)
     * for Phase 2 since a single generous ceiling is simpler and images/
     * audio will rarely come close to it anyway; worth revisiting only if
     * real usage shows it needs tightening per kind.
     */
    private const MAX_UPLOAD_KB = 204800;

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
     * POST /api/video-projects/{id}/assets — Phase 2. Adds a video, image,
     * or audio file to the project's bin WITHOUT starting a dub — the first
     * way to get a file into a project that isn't
     * VideoDubbingController::submit()'s upload-and-dub-in-one-step path
     * (see that method's docblock). One file per call, matching how the
     * frontend's file picker/drop-zone posts each file as its own request
     * (see VideoStudioFileUploader.tsx) rather than a multi-file batch
     * endpoint — simpler error handling per-file (one failed upload
     * doesn't roll back the others) at the cost of N requests for N files,
     * an acceptable trade for the bin-upload volumes expected here.
     */
    public function addAsset(Request $request, string $id)
    {
        $project = $request->user()->videoProjects()->find($id);
        if (! $project) {
            return response()->json(['message' => 'Video project not found.'], 404);
        }

        $validated = $request->validate([
            'file' => [
                'required', 'file', 'max:' . self::MAX_UPLOAD_KB,
                'mimetypes:video/mp4,video/quicktime,video/x-matroska,video/webm,' .
                'audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg,audio/webm,' .
                'image/jpeg,image/png,image/webp,image/gif',
            ],
        ]);

        $file = $validated['file'];
        $mime = (string) $file->getMimeType();
        $kind = match (true) {
            str_starts_with($mime, 'video/') => 'video',
            str_starts_with($mime, 'audio/') => 'audio',
            str_starts_with($mime, 'image/') => 'image',
            // Unreachable given the mimetypes rule above, but a
            // silently-wrong 'video' guess would be worse than a clear 422
            // if a browser ever reports a mimetype outside that allowlist.
            default => null,
        };
        if (! $kind) {
            return response()->json(['message' => 'Unsupported file type.'], 422);
        }

        $assetId = (string) Str::uuid();
        $ext = strtolower($file->getClientOriginalExtension()) ?: match ($kind) {
            'video' => 'mp4', 'audio' => 'wav', 'image' => 'jpg',
        };
        $storedPath = "video/{$project->user_id}/project-assets/{$assetId}.{$ext}";
        Storage::disk('video')->put($storedPath, file_get_contents($file->getRealPath()));

        // Video/audio get a real duration for the timeline (Phase 5) to
        // use later; images don't have one. Probed from a local tmp copy
        // read back through Storage rather than assuming a local disk path
        // — same disk-agnostic pattern PrepareDubbingJob uses, since
        // VIDEO_DISK can be s3 (see .env.example) and ffprobe needs a real
        // filesystem path either way.
        $duration = null;
        if ($kind !== 'image') {
            $tmp = tempnam(sys_get_temp_dir(), 'vsasset_');
            try {
                $stream = Storage::disk('video')->readStream($storedPath);
                file_put_contents($tmp, stream_get_contents($stream));
                fclose($stream);
                $duration = $this->probeDuration($tmp);
            } finally {
                @unlink($tmp);
            }
        }

        $asset = VideoProjectAsset::create([
            'video_project_id'  => $project->id,
            'kind'              => $kind,
            'source'            => 'upload',
            'original_filename' => $file->getClientOriginalName(),
            'storage_path'      => $storedPath,
            'duration_seconds'  => $duration,
            'status'            => 'ready',
        ]);
        $project->touch();

        return response()->json([
            'id'                 => $asset->id,
            'kind'               => $asset->kind,
            'source'             => $asset->source,
            'parent_asset_id'    => null,
            'dubbing_job_id'     => null,
            'original_filename'  => $asset->original_filename,
            'duration_seconds'   => $asset->duration_seconds,
            'status'             => $asset->status,
            'created_at'         => $asset->created_at?->toIso8601String(),
        ], 201);
    }

    /**
     * GET /api/video-projects/{id}/assets/{assetId}/file — streams a
     * plain-upload bin asset's own file (video/audio/image). NOT used for
     * 'dubbed' assets — those have no file of their own until their
     * dubbing job finishes; the frontend reads a dubbed asset's file
     * through VideoDubbingController::result()/source() via its
     * dubbing_job_id instead, same as it already does outside project
     * context. 404 (not a bare "file missing") when the asset doesn't
     * belong to this project/user, to avoid leaking asset-id existence
     * across accounts — same ownership-then-existence check order used
     * throughout this controller.
     */
    public function assetFile(Request $request, string $id, string $assetId)
    {
        $project = $request->user()->videoProjects()->find($id);
        if (! $project) {
            return response()->json(['message' => 'Video project not found.'], 404);
        }

        $asset = $project->assets()->find($assetId);
        if (! $asset || ! $asset->storage_path) {
            return response()->json(['message' => 'Asset not found.'], 404);
        }
        if (! Storage::disk('video')->exists($asset->storage_path)) {
            return response()->json(['message' => 'Asset file is missing.'], 410);
        }

        $contentType = match ($asset->kind) {
            'video' => 'video/mp4',
            'audio' => 'audio/wav',
            'image' => 'image/jpeg',
        };

        // Same fpassthru-a-readStream approach as
        // VideoDubbingController::streamVideo() — no Range-request/seek
        // support either, matching that existing (private, not reusable
        // from here) helper's own behavior rather than introducing a
        // second, differently-behaved streaming mechanism via
        // Storage::disk()->response() for this one endpoint.
        $stream = Storage::disk('video')->readStream($asset->storage_path);
        return response()->stream(function () use ($stream) {
            fpassthru($stream);
            if (is_resource($stream)) {
                fclose($stream);
            }
        }, 200, [
            'Content-Type'        => $contentType,
            'Content-Disposition' => 'inline; filename="' . ($asset->original_filename ?: $asset->id) . '"',
        ]);
    }

    /**
     * DELETE /api/video-projects/{id}/assets/{assetId} — removes one bin
     * asset. For a 'dubbed'-source asset (dubbing_job_id set), this only
     * removes the bin reference — same "don't reach into another
     * feature's storage lifecycle" boundary as destroy() above; the
     * underlying DubbingJob and its files are untouched and still visible
     * in the unscoped Video Studio job history.
     */
    public function deleteAsset(Request $request, string $id, string $assetId)
    {
        $project = $request->user()->videoProjects()->find($id);
        if (! $project) {
            return response()->json(['message' => 'Video project not found.'], 404);
        }

        $asset = $project->assets()->find($assetId);
        if (! $asset) {
            return response()->json(['message' => 'Asset not found.'], 404);
        }

        if (! $asset->dubbing_job_id && $asset->storage_path) {
            try {
                Storage::disk('video')->delete($asset->storage_path);
            } catch (\Throwable) {
                // Missing/unreachable file must not block removing the row.
            }
        }

        $asset->delete();
        $project->touch();

        return response()->json(null, 204);
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
