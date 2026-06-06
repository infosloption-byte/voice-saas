<?php

namespace App\Http\Controllers;

use App\Models\Project;
use App\Models\Script;
use App\Services\PlanLimits;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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

        if ($script->audio_url && Storage::disk('local')->exists($script->audio_url)) {
            Storage::disk('local')->delete($script->audio_url);
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

        $path = 'audio/' . $request->user()->id . '/' . $id . '.wav';

        if ($script->audio_url && Storage::disk('local')->exists($script->audio_url)) {
            Storage::disk('local')->delete($script->audio_url);
        }

        try {
            Storage::disk('local')->put($path, $request->file('file')->get());
        } catch (\Throwable $e) {
            return response()->json(['message' => 'Failed to store audio file.'], 500);
        }

        $script->update(['audio_url' => $path]);

        return response()->json(['audio_url' => $path]);
    }

    public function serveAudio(Request $request, string $id)
    {
        $script = Script::whereHas('project', function ($q) use ($request) {
            $q->where('user_id', $request->user()->id);
        })->findOrFail($id);

        if (!$script->audio_url || !Storage::disk('local')->exists($script->audio_url)) {
            abort(404, 'Audio file not found');
        }

        $content = Storage::disk('local')->get($script->audio_url);
        return response($content, 200, [
            'Content-Type'        => 'audio/wav',
            'Content-Disposition' => 'inline; filename="' . $id . '.wav"',
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

        foreach ($validated['scripts'] as $scriptData) {
            $project->scripts()->where('id', $scriptData['id'])->update(['order_index' => $scriptData['order_index']]);
        }

        return response()->json(['message' => 'Scripts reordered successfully']);
    }
}
