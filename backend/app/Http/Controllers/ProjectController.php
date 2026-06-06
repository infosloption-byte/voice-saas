<?php

namespace App\Http\Controllers;

use App\Models\Project;
use Illuminate\Http\Request;

class ProjectController extends Controller
{
    public function index(Request $request)
    {
        return response()->json($request->user()->projects()->with('scripts')->get());
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'id'          => 'required|string|max:36',
            'name'        => 'required|string|max:255',
            'emoji'       => 'nullable|string|max:10',
            'description' => 'nullable|string|max:2000',
        ]);

        $project = $request->user()->projects()->create($validated);
        $project->load('scripts');

        return response()->json($project);
    }

    public function update(Request $request, string $id)
    {
        $project = $request->user()->projects()->findOrFail($id);
        
        $validated = $request->validate([
            'name'           => 'nullable|string|max:255',
            'emoji'          => 'nullable|string|max:10',
            'description'    => 'nullable|string|max:2000',
            'timeline_clips' => 'nullable|array',
            'lane_config'    => 'nullable|array',
        ]);

        $project->update($validated);
        $project->load('scripts');

        return response()->json($project);
    }

    public function destroy(Request $request, string $id)
    {
        $project = $request->user()->projects()->findOrFail($id);
        $project->delete();

        return response()->json(null, 204);
    }
}
