<?php

namespace App\Http\Controllers;

use App\Services\PlanLimits;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SynthesisUsageController extends Controller
{
    /**
     * GET /api/synthesis/quota
     * Returns the authenticated user's synthesis quota for the current period.
     *
     * Response:
     *   { limit: int, used: int, remaining: int, period: 'day'|'month' }
     *   limit = 0 means unlimited (remaining is PHP_INT_MAX)
     */
    public function quota(Request $request): JsonResponse
    {
        $user   = $request->user();
        $limits = PlanLimits::forUser($user);

        $rawLimit = isset($limits['synth_limit']) ? (int) $limits['synth_limit'] : null;
        $period   = $limits['synth_period'] ?? 'day';

        // NULL → inherit from free tier
        if ($rawLimit === null) {
            $freeLimits = PlanLimits::forPlan('free');
            $rawLimit   = isset($freeLimits['synth_limit']) ? (int) $freeLimits['synth_limit'] : 3;
            $period     = $freeLimits['synth_period'] ?? 'day';
        }

        // 0 = unlimited
        if ($rawLimit === 0) {
            return response()->json([
                'limit'     => 0,
                'used'      => 0,
                'remaining' => PHP_INT_MAX,
                'period'    => $period,
            ]);
        }

        $periodKey = $period === 'month'
            ? now()->format('Y-m')
            : now()->format('Y-m-d');

        $used = (int) DB::table('synthesis_usage')
            ->where('user_id',     $user->id)
            ->where('period_type', $period)
            ->where('period_key',  $periodKey)
            ->value('count') ?: 0;

        return response()->json([
            'limit'     => $rawLimit,
            'used'      => $used,
            'remaining' => max(0, $rawLimit - $used),
            'period'    => $period,
        ]);
    }

    /**
     * POST /api/synthesis/record
     * Increment the authenticated user's synthesis count for the current period.
     *
     * Response: same shape as quota()
     */
    public function record(Request $request): JsonResponse
    {
        $user   = $request->user();
        $limits = PlanLimits::forUser($user);

        $rawLimit = isset($limits['synth_limit']) ? (int) $limits['synth_limit'] : null;
        $period   = $limits['synth_period'] ?? 'day';

        if ($rawLimit === null) {
            $freeLimits = PlanLimits::forPlan('free');
            $rawLimit   = isset($freeLimits['synth_limit']) ? (int) $freeLimits['synth_limit'] : 3;
            $period     = $freeLimits['synth_period'] ?? 'day';
        }

        $periodKey = $period === 'month'
            ? now()->format('Y-m')
            : now()->format('Y-m-d');

        DB::table('synthesis_usage')->upsert(
            [
                'user_id'     => $user->id,
                'period_type' => $period,
                'period_key'  => $periodKey,
                'count'       => 1,
                'created_at'  => now(),
                'updated_at'  => now(),
            ],
            ['user_id', 'period_type', 'period_key'],
            ['count'   => DB::raw('count + 1'), 'updated_at' => now()]
        );

        // Return fresh quota so the frontend can update immediately
        return $this->quota($request);
    }
}
