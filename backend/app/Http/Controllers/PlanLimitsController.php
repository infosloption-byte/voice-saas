<?php

namespace App\Http\Controllers;

use App\Services\PlanLimits;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PlanLimitsController extends Controller
{
    /**
     * GET /api/plan-limits
     * Public — returns current limits for all three plans.
     * The frontend uses this to display accurate gating messages.
     */
    public function index(): JsonResponse
    {
        return response()->json(PlanLimits::all());
    }

    /**
     * PUT /api/admin/plan-limits/{plan}
     * Admin-only — update limits for a single plan.
     *
     * Body (all fields optional):
     *   project_limit  int   0 = unlimited
     *   profile_limit  int   0 = unlimited
     *   word_limit     int   0 = unlimited
     *   multi_voice    bool
     *   data_export    bool
     *
     * Access is protected by the 'admin' middleware (checks user email against
     * the ADMIN_EMAIL env variable).
     */
    public function update(Request $request, string $plan): JsonResponse
    {
        if (! in_array($plan, ['free', 'starter', 'pro'], true)) {
            return response()->json(['message' => 'Invalid plan name.'], 422);
        }

        $validated = $request->validate([
            'project_limit' => 'sometimes|integer|min:0',
            'profile_limit' => 'sometimes|integer|min:0',
            'word_limit'    => 'sometimes|integer|min:0',
            'multi_voice'   => 'sometimes|boolean',
            'data_export'   => 'sometimes|boolean',
        ]);

        if (empty($validated)) {
            return response()->json(['message' => 'No fields to update.'], 422);
        }

        DB::table('plan_limits')
            ->where('plan', $plan)
            ->update(array_merge($validated, ['updated_at' => now()]));

        PlanLimits::flushCache();

        return response()->json([
            'message' => "Plan limits for '{$plan}' updated successfully.",
            'limits'  => PlanLimits::all(),
        ]);
    }
}
