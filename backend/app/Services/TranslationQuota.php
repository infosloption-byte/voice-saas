<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Single source of truth for translation quota math.
 * Mirrors the shape of SynthesisQuota so both quota types are consistent.
 */
class TranslationQuota
{
    /** @return array{limit:int, period:string}  limit 0 = unlimited */
    public static function policy(User $user): array
    {
        $limits = PlanLimits::forUser($user);

        $limit  = isset($limits['translate_limit']) ? (int) $limits['translate_limit'] : null;
        $period = $limits['translate_period'] ?? 'month';

        if ($limit === null) {
            $free   = PlanLimits::forPlan('free');
            $limit  = isset($free['translate_limit']) ? (int) $free['translate_limit'] : 10;
            $period = $free['translate_period'] ?? 'month';
        }

        return ['limit' => $limit, 'period' => $period];
    }

    public static function periodKey(): string
    {
        return now()->format('Y-m');
    }

    /** @return array{limit:int, used:int, remaining:int, period:string} */
    public static function snapshot(User $user): array
    {
        ['limit' => $limit, 'period' => $period] = self::policy($user);

        if ($limit === 0) {
            return ['limit' => 0, 'used' => 0, 'remaining' => PHP_INT_MAX, 'period' => $period];
        }

        $used = (int) DB::table('translation_usage')
            ->where('user_id',     $user->id)
            ->where('period_type', $period)
            ->where('period_key',  self::periodKey())
            ->value('count') ?: 0;

        return [
            'limit'     => $limit,
            'used'      => $used,
            'remaining' => max(0, $limit - $used),
            'period'    => $period,
        ];
    }

    public static function hasRemaining(User $user): bool
    {
        $snap = self::snapshot($user);
        return $snap['limit'] === 0 || $snap['remaining'] > 0;
    }

    /**
     * Check quota and record usage atomically. Returns null on success, or a
     * JSON response (422) when the quota is exhausted.
     */
    public static function checkAndRecord(User $user): ?array
    {
        ['limit' => $limit, 'period' => $period] = self::policy($user);

        if ($limit === 0) {
            return null; // unlimited
        }

        $periodKey = self::periodKey();

        $used = (int) DB::table('translation_usage')
            ->where('user_id',     $user->id)
            ->where('period_type', $period)
            ->where('period_key',  $periodKey)
            ->value('count') ?: 0;

        if ($used >= $limit) {
            return [
                'message' => "You've used all {$limit} translations for this month. "
                    . PlanLimits::nextPlanHint($user->plan_name) . ' for more.',
                'code'    => 'plan_limit_translations',
                'limit'   => $limit,
                'used'    => $used,
            ];
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

        return null;
    }
}
