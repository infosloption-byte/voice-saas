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
            'id' => 'required|string',
            'name' => 'required|string',
            'emoji' => 'nullable|string',
            'description' => 'nullable|string',
        ]);

        $project = $request->user()->projects()->create($validated);
        $project->load('scripts');

        return response()->json($project);
    }

    public function update(Request $request, string $id)
    {
        $project = $request->user()->projects()->findOrFail($id);
        
        $validated = $request->validate([
            'name' => 'nullable|string',
            'emoji' => 'nullable|string',
            'description' => 'nullable|string',
            'timeline_clips' => 'nullable|array',
        ]);

        $project->update($validated);

        return response()->json($project);
    }

    public function destroy(Request $request, string $id)
    {
        $project = $request->user()->projects()->findOrFail($id);
        $project->delete();

        return response()->json(null, 204);
    }
}
