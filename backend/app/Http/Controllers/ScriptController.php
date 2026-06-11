<?php

namespace App\Http\Controllers;

use App\Models\Project;
use App\Models\Script;
use App\Services\PlanLimits;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
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
            'engine'         => 'nullable|string|in:xtts,f5',
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
            'has_audio'      => 'boolean',
            'profile_id'     => 'nullable|string|max:36',
            'language'       => 'string|max:10',
            'duration'       => 'nullable|numeric|min:0|max:86400',
            'speed'          => 'numeric|min:0.25|max:4',
            'tone'           => 'nullable|string|max:50',
            'engine'         => 'nullable|string|in:xtts,f5',
            'speaker_map'    => 'nullable|array',
            'waveform_peaks' => 'nullable|array',
            'advanced_params'=> 'nullable|array',
            'order_index'    => 'integer|min:0',
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
            'has_audio'   => 'boolean',
            'profile_id'  => 'nullable|string|max:36',
            'language'    => 'string|max:10',
            'duration'    => 'nullable|numeric|min:0|max:86400',
            'speed'       => 'numeric|min:0.25|max:4',
            'tone'        => 'nullable|string|max:50',
            'engine'          => 'nullable|string|in:xtts,f5',
            'speaker_map'     => 'nullable|array',
            'waveform_peaks'  => 'nullable|array',
            'advanced_params' => 'nullable|array',
            'order_index'     => 'integer',
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
        try {
            $proc = proc_open(
                ['ffmpeg', '-y', '-i', $tmpWav, '-codec:a', 'libmp3lame', '-q:a', '4', $tmpMp3],
                [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes
            );
            $ok = is_resource($proc) && proc_close($proc) === 0 && file_exists($tmpMp3);
        } catch (\Throwable) {
            $ok = false;
        }

        if ($ok) {
            $bytes = file_get_contents($tmpMp3);
        } else {
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
            Storage::disk('audio')->put($storePath, $bytes);
        } catch (\Throwable $e) {
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

        if (!$script->audio_url || !Storage::disk('audio')->exists($script->audio_url)) {
            abort(404, 'Audio file not found');
        }

        $isS3 = config('filesystems.disks.audio.driver') === 's3';
        if ($isS3) {
            // Issue a temporary signed URL (10 min) and redirect.
            $url = Storage::disk('audio')->temporaryUrl($script->audio_url, now()->addMinutes(10));
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
