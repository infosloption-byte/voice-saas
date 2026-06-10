<?php

namespace App\Http\Controllers;

use App\Services\PlanLimits;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;

class GuestLimitsController extends Controller
{
    /**
     * GET /api/guest-limits
     * Public endpoint used before login. Reads the 'guest' tier from the
     * unified plan_limits table (via PlanLimits service) and returns it in
     * the legacy shape the frontend expects.
     *
     * Hit on every app load by logged-out visitors, so the result is cached
     * for an hour (cleared implicitly when limits change rarely enough).
     */
    public function show(): JsonResponse
    {
        $limits = Cache::remember('guest_limits', 3600, fn () => PlanLimits::guestLimits());

        return response()->json($limits);
    }
}
