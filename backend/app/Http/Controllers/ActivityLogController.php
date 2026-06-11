<?php

namespace App\Http\Controllers;

use App\Models\ActivityLog;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class ActivityLogController extends Controller
{
    // GET /activity-logs?project_id=&limit=100
    public function index(Request $request): JsonResponse
    {
        $query = ActivityLog::where('user_id', $request->user()->id)
            ->orderBy('started_at', 'desc');

        if ($request->filled('project_id')) {
            $query->where('project_id', $request->project_id);
        }

        $limit = min((int) ($request->query('limit', 100)), 200);

        return response()->json($query->limit($limit)->get());
    }

    // POST /activity-logs
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'project_id' => 'nullable|string|max:36',
            'event_type' => 'nullable|string|max:50',
            'message'    => 'required|string|max:255',
            'detail'     => 'nullable|string|max:1000',
            'status'     => 'nullable|in:running,done,failed',
            'started_at' => 'nullable|date',
        ]);

        $log = ActivityLog::create([
            'user_id'    => $request->user()->id,
            'project_id' => $data['project_id'] ?? null,
            'event_type' => $data['event_type'] ?? 'task',
            'message'    => $data['message'],
            'detail'     => $data['detail'] ?? null,
            'status'     => $data['status'] ?? 'running',
            'started_at' => isset($data['started_at']) ? $data['started_at'] : now(),
        ]);

        return response()->json($log, 201);
    }

    // PATCH /activity-logs/{log}
    public function update(Request $request, ActivityLog $activityLog): JsonResponse
    {
        if ($activityLog->user_id !== $request->user()->id) {
            abort(403);
        }

        $data = $request->validate([
            'message'  => 'nullable|string|max:255',
            'detail'   => 'nullable|string|max:1000',
            'status'   => 'nullable|in:running,done,failed',
            'ended_at' => 'nullable|date',
        ]);

        // Auto-set ended_at when transitioning to a terminal status
        if (
            isset($data['status'])
            && in_array($data['status'], ['done', 'failed'])
            && !$activityLog->ended_at
            && empty($data['ended_at'])
        ) {
            $data['ended_at'] = now();
        }

        $activityLog->update(array_filter($data, fn($v) => $v !== null));

        return response()->json($activityLog->fresh());
    }

    // DELETE /activity-logs?project_id=
    public function destroy(Request $request): JsonResponse
    {
        $query = ActivityLog::where('user_id', $request->user()->id);

        if ($request->filled('project_id')) {
            $query->where('project_id', $request->project_id);
        }

        $query->delete();

        return response()->json(['ok' => true]);
    }
}
