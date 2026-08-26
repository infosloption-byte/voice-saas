<?php

namespace App\Http\Controllers;

use App\Jobs\Concerns\DubbingPipelineHelpers;
use App\Jobs\ExtractAudioAssetJob;
use App\Jobs\PrepareDubbingJob;
use App\Jobs\SynthesizeAudioAssetJob;
use App\Models\ActivityLog;
use App\Models\DubbingJob;
use App\Models\VideoProject;
use App\Models\VideoProjectAsset;
use App\Models\VoiceProfile;
use App\Services\EngineResolver;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Task #15 (Video Studio) Phases 1-4. See docs/ENHANCEMENT_TASKS.md task
 * #15 for the full phased plan. Phase 6's render()/outputFile() are NOT
 * here yet — adding them as stubs now would just be dead code to delete
 * or rewrite once that phase is actually designed.
 *
 * Quota gating (project count, asset uploads, renders, dubClip(),
 * extractAudio(), resynthesize()) is deliberately NOT wired in here yet —
 * see the "Open questions" in task #15: there is no `video_project_limit`
 * key in PlanLimits yet, and calling PlanLimits::limit() with an unknown
 * key silently resolves to "unlimited" (see PlanLimits::limit()'s
 * null-coalesce-to-0-means-unlimited fallback) rather than actually
 * enforcing anything — that would look like enforcement in the code
 * without being real enforcement, which is worse than the honest gap
 * this comment is flagging instead. dubClip() and resynthesize() ride on
 * whatever PrepareDubbingJob/FinalizeDubbingJob/SynthesisQuota already
 * enforce for translation/synthesis quota, same as /dubbing/submit — no
 * new gate was added or needed here.
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

        // Task #15 Phase 3 — poll-on-read, same pattern task #6a's
        // syncDubbedClipStatuses() used: a 'dubbed' asset's underlying
        // DubbingJob runs independently (its own queue worker, its own
        // progress polled by the job-card list the library already
        // renders), so this only needs to catch the asset row up to
        // whatever the job's status is by the time the project is next
        // fetched — no webhook/callback from FinalizeDubbingJob needed.
        $this->syncDubbedAssetStatuses($project);

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
     * POST /api/video-projects/{id}/assets/{assetId}/dub — task #15
     * Phase 3. Starts a real dubbing job for a plain 'video' bin asset
     * (one added via addAsset() or a legacy /dubbing/submit upload) and
     * creates a 'dubbed'-kind placeholder asset that tracks it.
     *
     * Adapts task #6a's dubClip() design (confirmed sound by re-reading
     * it before its own files were deleted on retirement — see task #15's
     * "What already exists and gets reused" note) against this phase's
     * schema: copy the source asset's file into a new job-scoped key
     * (same copy-not-point-at pattern VideoDubbingController::retry()
     * already uses, so the job's file lifecycle stays independent of the
     * bin asset's — deleting either later can't silently break the
     * other), create a normal DubbingJob + ActivityLog, dispatch the
     * existing, unmodified PrepareDubbingJob, and immediately create a
     * 'dubbed' placeholder asset ('processing' status, dubbing_job_id
     * pointing at the new job, parent_asset_id pointing at the source
     * clip). Nothing in the dubbing pipeline itself is touched by this
     * method — same "don't reach into another feature's internals"
     * boundary the rest of this controller already keeps.
     *
     * The new asset intentionally does NOT show up in plainAssets on the
     * frontend once dubbing_job_id is set (see VideoStudioPage's — err,
     * DubbingStudioPage's — plainAssets filter) — it surfaces through the
     * job-card list instead (GET /dubbing?video_project_id=... already
     * resolves job ids via video_project_assets.dubbing_job_id, see
     * VideoDubbingController::index()), so no separate progress-polling
     * endpoint was needed here. "Review" hands off into the existing,
     * unchanged DubbingTimelineEditor once the job reaches
     * ready_for_review — same reasoning task #6b already established for
     * not re-deriving segment editing a second time.
     */
    public function dubClip(Request $request, string $id, string $assetId)
    {
        $user = $request->user();
        $project = $user->videoProjects()->find($id);
        if (! $project) {
            return response()->json(['message' => 'Video project not found.'], 404);
        }

        $asset = $project->assets()->find($assetId);
        if (! $asset) {
            return response()->json(['message' => 'Asset not found.'], 404);
        }
        if ($asset->kind !== 'video') {
            return response()->json(['message' => 'Only video assets can be dubbed.'], 422);
        }
        if ($asset->dubbing_job_id) {
            return response()->json(['message' => 'This clip already has a dub in progress or completed. Delete the dubbed variant first to dub it again.'], 409);
        }
        if (! $asset->storage_path || ! Storage::disk('video')->exists($asset->storage_path)) {
            return response()->json(['message' => 'This clip\'s file is missing or has expired.'], 410);
        }

        $validated = $request->validate([
            'target_language'  => ['required', 'string', 'max:10'],
            'source_language'  => ['nullable', 'string', 'max:10'],
            'voice_profile_id' => ['required', 'string', 'max:100'],
            'engine'           => ['nullable', 'string', EngineResolver::engineValidationRule()],
        ]);

        // Same ownership check as VideoDubbingController::submit()/retry().
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
        Storage::disk('video')->copy($asset->storage_path, $storedPath);

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
            'original_filename' => $asset->original_filename,
            'status'            => 'queued',
            'progress'          => 0,
            'source_video_path' => $storedPath,
        ]);

        PrepareDubbingJob::dispatch($job->id);

        $dubbedAsset = VideoProjectAsset::create([
            'video_project_id'  => $project->id,
            'kind'              => 'video',
            'source'            => 'dubbed',
            'parent_asset_id'   => $asset->id,
            'dubbing_job_id'    => $job->id,
            'original_filename' => $asset->original_filename,
            'status'            => 'processing',
        ]);
        $project->touch();

        return response()->json([
            'job_id'  => $job->id,
            'asset_id' => $dubbedAsset->id,
            'status'  => 'queued',
        ], 201);
    }

    /**
     * POST /api/video-projects/{id}/assets/{assetId}/extract-audio —
     * task #15 Phase 4, step 1. Starts pulling the audio track off a
     * video bin asset (source OR dubbed, either is a fine source clip to
     * extract from) and transcribing it into an editable segment list.
     * Creates the 'extracted_audio' placeholder asset synchronously and
     * dispatches ExtractAudioAssetJob to do the real (ffmpeg + Whisper)
     * work — same immediate-placeholder-then-poll-on-read shape dubClip()
     * already established for dubbed assets, except there's no separate
     * DubbingJob row to poll here: the placeholder asset's own
     * `status`/`error` ARE the job's state (see ExtractAudioAssetJob's
     * docblock for why there's no ActivityLog/job-table layer for this).
     */
    public function extractAudio(Request $request, string $id, string $assetId)
    {
        $project = $request->user()->videoProjects()->find($id);
        if (! $project) {
            return response()->json(['message' => 'Video project not found.'], 404);
        }

        $source = $project->assets()->find($assetId);
        if (! $source) {
            return response()->json(['message' => 'Asset not found.'], 404);
        }
        if ($source->kind !== 'video') {
            return response()->json(['message' => 'Audio can only be extracted from a video asset.'], 422);
        }
        if (! $source->storage_path || ! Storage::disk('video')->exists($source->storage_path)) {
            return response()->json(['message' => 'This clip\'s file is missing or has expired — if it\'s still dubbing, wait for it to finish first.'], 410);
        }

        $placeholder = VideoProjectAsset::create([
            'video_project_id'  => $project->id,
            'kind'              => 'audio',
            'source'            => 'extracted_audio',
            'parent_asset_id'   => $source->id,
            'original_filename' => trim(($source->original_filename ?: 'clip') . ' — extracted audio'),
            'status'            => 'processing',
        ]);
        $project->touch();

        ExtractAudioAssetJob::dispatch($placeholder->id, $source->id);

        return response()->json(['asset_id' => $placeholder->id, 'status' => 'processing'], 201);
    }

    /**
     * PATCH /api/video-projects/{id}/assets/{assetId}/transcript — task
     * #15 Phase 4, review step. Lets the user fix transcription errors
     * before spending synthesis quota. Only allowed on a 'ready'
     * extracted_audio asset — same "original stays immutable, only text
     * is editable, unknown ids silently dropped" guard
     * VideoDubbingController::updateSegments() already uses for the
     * (unrelated) dubbing review timeline, applied here to the simpler
     * id/text-only shape this feature actually needs.
     */
    public function updateTranscript(Request $request, string $id, string $assetId)
    {
        $project = $request->user()->videoProjects()->find($id);
        if (! $project) {
            return response()->json(['message' => 'Video project not found.'], 404);
        }

        $asset = $project->assets()->find($assetId);
        if (! $asset || $asset->source !== 'extracted_audio') {
            return response()->json(['message' => 'Asset not found.'], 404);
        }
        if ($asset->status !== 'ready') {
            return response()->json(['message' => 'This transcript is not ready to edit yet.', 'status' => $asset->status], 409);
        }

        $validated = $request->validate([
            'segments'              => ['required', 'array', 'min:1'],
            'segments.*.id'         => ['required', 'string'],
            'segments.*.text'       => ['required', 'string'],
        ]);

        $existing = collect($asset->transcript_json ?? [])->keyBy('id');
        $updated = false;
        foreach ($validated['segments'] as $edit) {
            if (! $existing->has($edit['id'])) {
                continue; // Unknown id — same silent-drop guard updateSegments() uses.
            }
            $seg = $existing->get($edit['id']);
            $seg['text'] = $edit['text'];
            $existing->put($edit['id'], $seg);
            $updated = true;
        }
        if (! $updated) {
            return response()->json(['message' => 'No matching segments to update.'], 422);
        }

        $asset->update(['transcript_json' => $existing->values()->all()]);

        return response()->json(['segments' => $asset->transcript_json]);
    }

    /**
     * POST /api/video-projects/{id}/assets/{assetId}/resynthesize — task
     * #15 Phase 4, step 2. `assetId` is the 'extracted_audio' asset whose
     * (possibly just-edited) transcript_json gets synthesized. Creates a
     * 'synthesized_audio' placeholder asset and dispatches
     * SynthesizeAudioAssetJob — same immediate-placeholder pattern as
     * extractAudio() and dubClip().
     *
     * No re-dub-style "already has a result" guard here (unlike
     * dubClip()'s check on dubbing_job_id) — an extracted_audio asset can
     * be resynthesized more than once (different voice, or after editing
     * the transcript again), each producing its own independent
     * synthesized_audio sibling. That's intentional, not an oversight:
     * a user comparing two voices on the same transcript is a real,
     * expected use of this feature.
     */
    public function resynthesize(Request $request, string $id, string $assetId)
    {
        $user = $request->user();
        $project = $user->videoProjects()->find($id);
        if (! $project) {
            return response()->json(['message' => 'Video project not found.'], 404);
        }

        $source = $project->assets()->find($assetId);
        if (! $source || $source->source !== 'extracted_audio') {
            return response()->json(['message' => 'Asset not found.'], 404);
        }
        if ($source->status !== 'ready' || empty($source->transcript_json)) {
            return response()->json(['message' => 'This transcript is not ready to synthesize yet.', 'status' => $source->status], 409);
        }

        $validated = $request->validate([
            'voice_profile_id' => ['required', 'string', 'max:100'],
            'engine'           => ['nullable', 'string', EngineResolver::engineValidationRule()],
            // Defaults to English if omitted — unlike dubbing, there's no
            // translation step here to infer a target language from; the
            // source clip's spoken language IS the output language, and
            // this app doesn't auto-detect-and-remember that anywhere yet
            // (Whisper's own detected_language from ExtractAudioAssetJob's
            // transcription isn't currently persisted — a reasonable
            // Phase 4 follow-up, not solved here to keep this endpoint's
            // scope to what it was asked to do).
            'language'         => ['nullable', 'string', 'max:10'],
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

        $placeholder = VideoProjectAsset::create([
            'video_project_id'  => $project->id,
            'kind'              => 'audio',
            'source'            => 'synthesized_audio',
            'parent_asset_id'   => $source->id,
            'original_filename' => trim(($source->original_filename ?: 'clip') . ' — cloned voice'),
            'status'            => 'processing',
        ]);
        $project->touch();

        SynthesizeAudioAssetJob::dispatch(
            $placeholder->id,
            $source->id,
            $user->id,
            $profileId,
            $validated['language'] ?? 'en',
            $validated['engine'] ?? null,
        );

        return response()->json(['asset_id' => $placeholder->id, 'status' => 'processing'], 201);
    }

    /**
     * GET /api/video-projects/{id}/assets/{assetId}/file — streams a bin
     * asset's own file. For a plain (source) asset that's always been
     * its uploaded video/audio/image. For a 'dubbed' asset (task #15
     * Phase 3), storage_path stays null until syncDubbedAssetStatuses()
     * fills it in once the underlying DubbingJob reaches 'done' — before
     * that, this 404s the same way a not-yet-uploaded asset would. The
     * frontend generally still prefers reading a 'processing'/pre-done
     * dubbed asset's preview through VideoDubbingController::result()/
     * source() via its dubbing_job_id (this endpoint doesn't proxy the
     * in-progress job at all — only a resolved file on this asset's own
     * storage_path), but once an asset is 'ready' either path serves the
     * identical file. 'extracted_audio'/'synthesized_audio' assets (Phase
     * 4) have no separate job-backed endpoint at all — this IS their only
     * file route, once ExtractAudioAssetJob/SynthesizeAudioAssetJob flips
     * them to 'ready'. 404 (not a bare "file missing") when the asset doesn't
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

    /**
     * Task #15 Phase 3 — catches each 'dubbed' asset row up to its linked
     * DubbingJob's current status. Only touches assets still 'processing'
     * (a 'ready'/'failed' asset's job has already been resolved once and
     * won't change again — DubbingJob rows are immutable once done/failed,
     * see VideoDubbingController), so this stays cheap on repeat show()
     * calls for a project with a long dubbing history. Deliberately does
     * NOT flip status while the job merely reaches 'ready_for_review' —
     * that's a mid-workflow checkpoint waiting on the user (see
     * VideoDubbingController::destroy()'s own "not running" carve-out for
     * the same status), not a resolved outcome, so the asset stays
     * 'processing' (surfaced via the job card's own "Ready to review"
     * badge) until the job is genuinely done or failed.
     */
    private function syncDubbedAssetStatuses(VideoProject $project): void
    {
        $pending = $project->assets->filter(
            fn(VideoProjectAsset $a) => $a->dubbing_job_id && $a->status === 'processing'
        );
        if ($pending->isEmpty()) {
            return;
        }

        $jobs = DubbingJob::whereIn('id', $pending->pluck('dubbing_job_id'))
            ->get()->keyBy('id');

        foreach ($pending as $asset) {
            $job = $jobs->get($asset->dubbing_job_id);
            if (! $job) {
                continue; // Job row itself was deleted independently — leave the asset as-is.
            }
            if ($job->status === 'done' && $job->result_video_path) {
                $asset->update([
                    'storage_path'     => $job->result_video_path,
                    'duration_seconds' => $job->duration_seconds,
                    'status'           => 'ready',
                ]);
            } elseif ($job->status === 'failed') {
                $asset->update(['status' => 'failed']);
            }
        }
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
                // Task #15 Phase 4 — only ever non-null on an
                // 'extracted_audio' asset. Included unconditionally
                // (rather than a separate GET) since show() already
                // fetches the whole project on every poll and this is
                // small (a few KB of segment text at most).
                'transcript_json'    => $a->transcript_json,
                'error'              => $a->error,
                'created_at'         => $a->created_at?->toIso8601String(),
            ]);
        }

        return $out;
    }
}
