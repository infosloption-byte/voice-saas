<?php

namespace App\Http\Controllers;

use App\Models\Project;
use App\Models\Script;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class ScriptController extends Controller
{
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
            'order_index'    => 'integer|min:0',
        ]);

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
            'order_index'    => 'integer|min:0',
        ]);

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
            'speaker_map' => 'nullable|array',
            'waveform_peaks' => 'nullable|array',
            'order_index' => 'integer',
        ]);

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

        Storage::disk('local')->put($path, $request->file('file')->get());
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
            'Cache-Control'       => 'private, max-age=3600',
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
