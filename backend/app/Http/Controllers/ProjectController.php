<?php

namespace App\Http\Controllers;

use App\Models\Project;
use App\Services\PlanLimits;
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
            // Reject control / invisible characters; a real emoji is short.
            'emoji'       => ['nullable', 'string', 'max:10', 'not_regex:/[\x00-\x1F\x7F]/'],
            'description' => 'nullable|string|max:2000',
        ]);

        $user  = $request->user();
        $limit = PlanLimits::limit($user, 'projects');

        if ($user->projects()->count() >= $limit) {
            return response()->json([
                'message' => "You've reached your plan's limit of {$limit} project"
                    . ($limit === 1 ? '' : 's') . '. ' . PlanLimits::nextPlanHint($user->plan_name) . ' for more.',
                'code'    => 'plan_limit_projects',
                'limit'   => $limit,
            ], 422);
        }

        $project = $user->projects()->create($validated);
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
