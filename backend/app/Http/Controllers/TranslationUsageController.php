<?php

namespace App\Http\Controllers;

use App\Services\PlanLimits;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TranslationUsageController extends Controller
{
    /**
     * GET /api/translation/quota
     * Returns the authenticated user's translation quota for the current period.
     */
    public function quota(Request $request): JsonResponse
    {
        $user   = $request->user();
        $limits = PlanLimits::forUser($user);

        $rawLimit = isset($limits['translate_limit']) ? (int) $limits['translate_limit'] : null;
        $period   = $limits['translate_period'] ?? 'month';

        if ($rawLimit === null) {
            $free     = PlanLimits::forPlan('free');
            $rawLimit = isset($free['translate_limit']) ? (int) $free['translate_limit'] : 10;
            $period   = $free['translate_period'] ?? 'month';
        }

        if ($rawLimit === 0) {
            return response()->json([
                'limit'     => 0,
                'used'      => 0,
                'remaining' => PHP_INT_MAX,
                'period'    => $period,
            ]);
        }

        $periodKey = now()->format('Y-m');

        $used = (int) DB::table('translation_usage')
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
     * POST /api/translation/record
     * Increment the authenticated user's translation count for the current period.
     * Returns 422 if quota exceeded.
     */
    public function record(Request $request): JsonResponse
    {
        $user   = $request->user();
        $limits = PlanLimits::forUser($user);

        $rawLimit = isset($limits['translate_limit']) ? (int) $limits['translate_limit'] : null;
        $period   = $limits['translate_period'] ?? 'month';

        if ($rawLimit === null) {
            $free     = PlanLimits::forPlan('free');
            $rawLimit = isset($free['translate_limit']) ? (int) $free['translate_limit'] : 10;
            $period   = $free['translate_period'] ?? 'month';
        }

        $periodKey = now()->format('Y-m');

        // Check quota before recording (skip for unlimited)
        if ($rawLimit > 0) {
            $used = (int) DB::table('translation_usage')
                ->where('user_id',     $user->id)
                ->where('period_type', $period)
                ->where('period_key',  $periodKey)
                ->value('count') ?: 0;

            if ($used >= $rawLimit) {
                return response()->json([
                    'message' => "You've used all {$rawLimit} translations for this month. "
                        . PlanLimits::nextPlanHint($user->plan_name) . ' for more.',
                    'code'    => 'plan_limit_translations',
                    'limit'   => $rawLimit,
                    'used'    => $used,
                ], 422);
            }
        }

        DB::table('translation_usage')->upsert(
            [
                'user_id'     => $user->id,
                'period_type' => $period,
                'period_key'  => $periodKey,
                'count'       => 1,
                'created_at'  => now(),
                'updated_at'  => now(),
            ],
            ['user_id', 'period_type', 'period_key'],
            ['count' => DB::raw('count + 1'), 'updated_at' => now()]
        );

        return $this->quota($request);
    }
}
