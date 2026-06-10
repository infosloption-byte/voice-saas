<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Single source of truth for synthesis quota math.
 *
 * Used by both SynthesisUsageController (the /synthesis/quota + /record
 * endpoints the frontend reads for display) and EngineSynthesisProxyController
 * (which enforces + records server-side so the limit can't be bypassed by
 * skipping the frontend record call).
 */
class SynthesisQuota
{
    /**
     * Resolve the effective synthesis limit + period for a user, applying the
     * free-tier fallback when the plan leaves it unset.
     *
     * @return array{limit:int, period:string}  limit 0 = unlimited
     */
    public static function policy(User $user): array
    {
        $limits = PlanLimits::forUser($user);

        $limit  = isset($limits['synth_limit']) ? (int) $limits['synth_limit'] : null;
        $period = $limits['synth_period'] ?? 'day';

        if ($limit === null) {
            $free   = PlanLimits::forPlan('free');
            $limit  = isset($free['synth_limit']) ? (int) $free['synth_limit'] : 3;
            $period = $free['synth_period'] ?? 'day';
        }

        return ['limit' => $limit, 'period' => $period];
    }

    /** Period bucket key, e.g. "2026-06" (month) or "2026-06-10" (day). */
    public static function periodKey(string $period): string
    {
        return $period === 'month' ? now()->format('Y-m') : now()->format('Y-m-d');
    }

    /**
     * Current usage snapshot for the user.
     *
     * @return array{limit:int, used:int, remaining:int, period:string}
     */
    public static function snapshot(User $user): array
    {
        ['limit' => $limit, 'period' => $period] = self::policy($user);

        if ($limit === 0) {
            return ['limit' => 0, 'used' => 0, 'remaining' => PHP_INT_MAX, 'period' => $period];
        }

        $used = (int) DB::table('synthesis_usage')
            ->where('user_id',     $user->id)
            ->where('period_type', $period)
            ->where('period_key',  self::periodKey($period))
            ->value('count') ?: 0;

        return [
            'limit'     => $limit,
            'used'      => $used,
            'remaining' => max(0, $limit - $used),
            'period'    => $period,
        ];
    }

    /** True when the user has synthesis budget left (or is unlimited). */
    public static function hasRemaining(User $user): bool
    {
        $snap = self::snapshot($user);
        return $snap['limit'] === 0 || $snap['remaining'] > 0;
    }

    /** Atomically increment the user's usage for the current period. */
    public static function record(User $user): void
    {
        ['limit' => $limit, 'period' => $period] = self::policy($user);

        // Unlimited plans don't need a usage row.
        if ($limit === 0) {
            return;
        }

        DB::table('synthesis_usage')->upsert(
            [
                'user_id'     => $user->id,
                'period_type' => $period,
                'period_key'  => self::periodKey($period),
                'count'       => 1,
                'created_at'  => now(),
                'updated_at'  => now(),
            ],
            ['user_id', 'period_type', 'period_key'],
            ['count' => DB::raw('count + 1'), 'updated_at' => now()]
        );
    }
}
