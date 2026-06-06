<?php

namespace App\Http\Controllers;

use App\Services\PlanLimits;
use Illuminate\Http\JsonResponse;

class GuestLimitsController extends Controller
{
    /**
     * GET /api/guest-limits
     * Public endpoint used before login. Reads the 'guest' tier from the
     * unified plan_limits table (via PlanLimits service) and returns it in
     * the legacy shape the frontend expects.
     */
    public function show(): JsonResponse
    {
        return response()->json(PlanLimits::guestLimits());
    }
}
