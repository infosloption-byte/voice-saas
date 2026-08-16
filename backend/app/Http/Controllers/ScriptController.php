<?php

namespace App\Http\Controllers;

use App\Models\Project;
use App\Models\Script;
use App\Services\EngineResolver;
use App\Services\PlanLimits;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class ScriptController extends Controller
{
    /**
     * Enforce per-plan limits on script content.
     * Returns a JsonResponse (422) when a limit is exceeded, or null when OK.
     */
    private function enforcePlan(Request $request, array $validated): ?JsonResponse
    {
        $user = $request->user();

        // Word-count limit per script
        if (array_key_exists('content', $validated)) {
            $limit = PlanLimits::limit($user, 'words');
            $words = PlanLimits::wordCount($validated['content'] ?? '');
            if ($words > $limit) {
                return response()->json([
                    'message' => "This script has {$words} words, but your plan allows up to "
                        . "{$limit} words per script. " . PlanLimits::nextPlanHint($user->plan_name) . ' for longer scripts.',
                    'code'    => 'plan_limit_words',
                    'limit'   => $limit,
                ], 422);
            }
        }

        // Multi-voice (speaker map with more than one distinct speaker) is paid-only
        if (! empty($validated['speaker_map']) && ! PlanLimits::allows($user, 'multi_voice')) {
            return response()->json([
                'message' => 'Multi-voice scripts are a paid feature. '
                    . PlanLimits::nextPlanHint($user->plan_name) . ' to assign multiple voices.',
                'code'    => 'plan_feature_multi_voice',
            ], 422);
        }

        return null;
    }

    public function store(Request $request, string $projectId)
    {
        $project = $request->user()->projects()->findOrFail($projectId);

        $validated = $request->validate([
            'id'             => 'required|string|max:36',
            'title'          => 'required|string|max:500',
            'content'        => 'nullable|string|max:50000',
            'has_audio'      => 'boolean',
            'profile_id'     => 'nullable|string|max:36',
            'language'       => 'string|max:10',
            'duration'       => 'nullable|numeric|min:0|max:86400',
            'speed'          => 'numeric|min:0.25|max:4',
            'tone'           => 'nullable|string|max:50',
            'engine'         => 'nullable|string|' . EngineResolver::engineValidationRule(),
            'speaker_map'    => 'nullable|array',
            'waveform_peaks' => 'nullable|array',
            'advanced_params'=> 'nullable|array',
            'order_index'    => 'integer|min:0',
        ]);

        if ($blocked = $this->enforcePlan($request, $validated)) {
            return $blocked;
        }

        $script = $project->scripts()->create($validated);

        return response()->json($script);
    }

    public function flatUpdate(Request $request)
    {
        $validated = $request->validate([
            'project_id'     => 'required|string|max:36',
            'script_id'      => 'required|string|max:36',
            'title'          => 'nullable|string|max:500',
            'content'        => 'nullable|string|max:50000',
            'profile_id'     => 'nullable|string|max:36',
            'language'       => 'string|max:10',
            'speed'          => 'numeric|min:0.25|max:4',
            'tone'           => 'nullable|string|max:50',
            'engine'         => 'nullable|string|' . EngineResolver::engineValidationRule(),
            'speaker_map'    => 'nullable|array',
            'advanced_params'=> 'nullable|array',
            'order_index'    => 'integer|min:0',
            // See ScriptController::update() for why has_audio / audio_url /
            // duration / waveform_peaks are excluded here.
        ]);

        if ($blocked = $this->enforcePlan($request, $validated)) {
            return $blocked;
        }

        $project = $request->user()->projects()->findOrFail($validated['project_id']);
        $script  = $project->scripts()->findOrFail($validated['script_id']);

        $script->update(collect($validated)->except(['project_id', 'script_id'])->toArray());

        return response()->json($script);
    }

    public function update(Request $request, string $projectId, string $id)
    {
        $project = $request->user()->projects()->findOrFail($projectId);
        $script = $project->scripts()->findOrFail($id);

        $validated = $request->validate([
            'title'       => 'nullable|string|max:500',
            'content'     => 'nullable|string|max:50000',
            'profile_id'  => 'nullable|string|max:36',
            'language'    => 'string|max:10',
            'speed'       => 'numeric|min:0.25|max:4',
            'tone'        => 'nullable|string|max:50',
            'engine'          => 'nullable|string|' . EngineResolver::engineValidationRule(),
            'speaker_map'     => 'nullable|array',
            'advanced_params' => 'nullable|array',
            'order_index'     => 'integer',
            // has_audio / audio_url / duration / waveform_peaks are intentionally
            // excluded — they are owned exclusively by the synthesis code paths
            // (BulkSynthesisJob::synthesiseScript, ScriptController::saveAudio).
            // Letting content-autosave write these caused a lost-update bug:
            // a stale client-side copy of has_audio/duration would overwrite the
            // values the synthesis job had just persisted, moments after the
            // job finished, even though the audio file was correctly in S3.
        ]);

        if ($blocked = $this->enforcePlan($request, $validated)) {
            return $blocked;
        }

        $script->update($validated);

        return response()->json($script);
    }

    public function destroy(Request $request, string $projectId, string $id)
    {
        $project = $request->user()->projects()->findOrFail($projectId);
        $script = $project->scripts()->findOrFail($id);

        if ($script->audio_url) {
            Storage::disk('audio')->delete($script->audio_url);
        }

        $script->delete();

        return response()->json(null, 204);
    }

    public function saveAudio(Request $request, string $id)
    {
        $script = Script::whereHas('project', function ($q) use ($request) {
            $q->where('user_id', $request->user()->id);
        })->findOrFail($id);

        $request->validate(['file' => 'required|file|max:102400']);

        // Delete old file (may be .wav or .mp3 from an earlier save)
        if ($script->audio_url) {
            Storage::disk('audio')->delete($script->audio_url);
        }

        $uploaded  = $request->file('file');
        $tmpWav    = $uploaded->getRealPath();
        $ext       = 'mp3';
        $storePath = $request->user()->id . '/' . $id . '.' . $ext;

        // Convert WAV → MP3 via ffmpeg (smaller files, browser-native playback).
        // Falls back to storing raw WAV if ffmpeg is not installed.
        $tmpMp3 = tempnam(sys_get_temp_dir(), 'vox_audio_') . '.mp3';
        $ffmpegError = null;
        try {
            $proc = proc_open(
                ['ffmpeg', '-y', '-i', $tmpWav, '-codec:a', 'libmp3lame', '-q:a', '4', $tmpMp3],
                [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes
            );
            $ok = is_resource($proc) && proc_close($proc) === 0 && file_exists($tmpMp3);
            if (!$ok) $ffmpegError = 'non-zero exit code or missing output file';
        } catch (\Throwable $e) {
            $ok = false;
            $ffmpegError = $e->getMessage();
        }

        if ($ok) {
            $bytes = file_get_contents($tmpMp3);
        } else {
            Log::warning("ScriptController::saveAudio: ffmpeg conversion failed for script {$id} ({$ffmpegError}) — falling back to raw WAV.");
            // ffmpeg unavailable — store WAV as-is
            $bytes     = $uploaded->get();
            $ext       = 'wav';
            $storePath = $request->user()->id . '/' . $id . '.' . $ext;
        }

        // Always clean up the temp file regardless of success or failure.
        if (file_exists($tmpMp3)) {
            @unlink($tmpMp3);
        }

        try {
            $putOk = Storage::disk('audio')->put($storePath, $bytes);
        } catch (\Throwable $e) {
            Log::error(
                "ScriptController::saveAudio: Storage::put() threw for script {$id}, " .
                "disk=" . config('filesystems.disks.audio.driver') . ", key='{$storePath}' — {$e->getMessage()}",
                ['exception' => $e]
            );
            return response()->json(['message' => 'Failed to store audio file.'], 500);
        }

        // 'throw' => false on the audio disk means put() can return false on a
        // failed write instead of throwing — check it explicitly, otherwise
        // we'd mark audio_url as saved when nothing was actually stored.
        if (!$putOk) {
            Log::error(
                "ScriptController::saveAudio: put() returned false (no exception) for script {$id}, " .
                "disk=" . config('filesystems.disks.audio.driver') . ", key='{$storePath}', bytes=" . strlen($bytes)
            );
            return response()->json(['message' => 'Failed to store audio file.'], 500);
        }

        $script->update(['audio_url' => $storePath]);

        return response()->json(['audio_url' => $storePath]);
    }

    public function serveAudio(Request $request, string $id)
    {
        $script = Script::whereHas('project', function ($q) use ($request) {
            $q->where('user_id', $request->user()->id);
        })->findOrFail($id);

        $disk = config('filesystems.disks.audio.driver');

        if (!$script->audio_url) {
            Log::warning("ScriptController::serveAudio: script {$id} has has_audio={$script->has_audio} but audio_url is empty — 404'ing.");
            abort(404, 'Audio file not found');
        }

        // NOTE: the 'audio' disk is configured with 'throw' => false, which means
        // Storage::exists() swallows any underlying S3 error (permissions, wrong
        // region/bucket, network) and just returns false. That makes a real
        // permission problem look identical to "file genuinely missing" from here.
        // Log loudly so the two cases can be told apart from the logs.
        try {
            $exists = Storage::disk('audio')->exists($script->audio_url);
        } catch (\Throwable $e) {
            // Shouldn't normally happen given 'throw' => false, but guard anyway
            // so a config change elsewhere doesn't turn this into an unhandled 500.
            Log::error(
                "ScriptController::serveAudio: exists() THREW for script {$id}, " .
                "disk={$disk}, key='{$script->audio_url}' — {$e->getMessage()}",
                ['exception' => $e]
            );
            abort(404, 'Audio file not found');
        }

        if (!$exists) {
            Log::warning(
                "ScriptController::serveAudio: 404 for script {$id} — disk={$disk}, " .
                "key='{$script->audio_url}', has_audio={$script->has_audio}. " .
                "If you can see this exact key in the S3 console/CLI, this is almost " .
                "certainly an IAM/bucket-policy issue: the app's credentials can write " .
                "(PutObject) but cannot read back (GetObject/HeadObject) this key. " .
                "Verify with the SAME credentials the app uses, not an admin/console session."
            );
            abort(404, 'Audio file not found');
        }

        $isS3 = $disk === 's3';
        if ($isS3) {
            try {
                // Issue a temporary signed URL (10 min) and redirect.
                $url = Storage::disk('audio')->temporaryUrl($script->audio_url, now()->addMinutes(10));
            } catch (\Throwable $e) {
                // temporaryUrl() talks to the AWS SDK directly and is NOT covered by
                // the disk's 'throw' => false setting — an exception here used to
                // propagate as a raw, unlogged 500. Log it with enough detail to
                // diagnose (credentials/region/signing), then fail loudly.
                Log::error(
                    "ScriptController::serveAudio: temporaryUrl() failed for script {$id}, " .
                    "key='{$script->audio_url}' — {$e->getMessage()}",
                    ['exception' => $e]
                );
                return response()->json([
                    'message' => 'Could not generate a download URL for this audio file.',
                ], 500);
            }

            Log::info("ScriptController::serveAudio: redirecting script {$id} to signed S3 URL (key='{$script->audio_url}')");
            return redirect($url);
        }

        $content  = Storage::disk('audio')->get($script->audio_url);
        $ext      = pathinfo($script->audio_url, PATHINFO_EXTENSION);
        $mimeType = $ext === 'mp3' ? 'audio/mpeg' : 'audio/wav';
        $filename = $id . '.' . $ext;

        return response($content, 200, [
            'Content-Type'        => $mimeType,
            'Content-Disposition' => 'inline; filename="' . $filename . '"',
            'Cache-Control'       => 'private, no-cache, must-revalidate',
            'Content-Length'      => strlen($content),
        ]);
    }

    public function reorder(Request $request, string $projectId)
    {
        $project = $request->user()->projects()->findOrFail($projectId);
        
        $validated = $request->validate([
            'scripts' => 'required|array',
            'scripts.*.id' => 'required|string',
            'scripts.*.order_index' => 'required|integer',
        ]);

        // Build one UPDATE … CASE statement instead of N separate queries.
        $ids   = array_column($validated['scripts'], 'id');
        $cases = collect($validated['scripts'])
            ->map(fn($s) => 'WHEN ' . DB::connection()->getPdo()->quote($s['id']) . ' THEN ' . (int) $s['order_index'])
            ->implode(' ');

        $project->scripts()
            ->whereIn('id', $ids)
            ->update(['order_index' => DB::raw("CASE id {$cases} END")]);

        return response()->json(['message' => 'Scripts reordered successfully']);
    }
}