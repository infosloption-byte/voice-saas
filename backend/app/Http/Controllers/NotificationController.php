<?php

namespace App\Http\Controllers;

use App\Mail\BulkSynthesisCompleteMail;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;

class NotificationController extends Controller
{
    /**
     * POST /api/notifications/bulk-synthesis-complete
     *
     * Called by the frontend after a bulk synthesis run finishes.
     * Sends a completion email to the authenticated user.
     *
     * Body: { project_name: string, total: int, failed: int }
     */
    public function bulkSynthesisComplete(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'project_name' => ['required', 'string', 'max:255'],
            'total'        => ['required', 'integer', 'min:0'],
            'failed'       => ['required', 'integer', 'min:0'],
        ]);

        $user      = $request->user();
        $total     = (int) $validated['total'];
        $failed    = (int) $validated['failed'];
        $completed = max(0, $total - $failed);

        Mail::to($user)->send(new BulkSynthesisCompleteMail(
            user:        $user,
            projectName: $validated['project_name'],
            total:       $total,
            completed:   $completed,
            failed:      $failed,
        ));

        return response()->json(['ok' => true]);
    }
}
