<?php

namespace App\Http\Controllers;

use App\Models\Project;
use App\Models\Script;
use Illuminate\Http\Request;

class ScriptController extends Controller
{
    public function store(Request $request, string $projectId)
    {
        $project = $request->user()->projects()->findOrFail($projectId);

        $validated = $request->validate([
            'id' => 'required|string',
            'title' => 'required|string',
            'content' => 'nullable|string',
            'has_audio' => 'boolean',
            'profile_id' => 'nullable|string',
            'language' => 'string',
            'duration' => 'nullable|numeric',
            'speed' => 'numeric',
            'waveform_peaks' => 'nullable|array',
            'order_index' => 'integer',
        ]);

        $script = $project->scripts()->create($validated);

        return response()->json($script);
    }

    public function flatUpdate(Request $request)
    {
        $validated = $request->validate([
            'project_id'     => 'required|string',
            'script_id'      => 'required|string',
            'title'          => 'nullable|string',
            'content'        => 'nullable|string',
            'has_audio'      => 'boolean',
            'profile_id'     => 'nullable|string',
            'language'       => 'string',
            'duration'       => 'nullable|numeric',
            'speed'          => 'numeric',
            'waveform_peaks' => 'nullable|array',
            'order_index'    => 'integer',
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
            'title' => 'nullable|string',
            'content' => 'nullable|string',
            'has_audio' => 'boolean',
            'profile_id' => 'nullable|string',
            'language' => 'string',
            'duration' => 'nullable|numeric',
            'speed' => 'numeric',
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
        
        $script->delete();

        return response()->json(null, 204);
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
