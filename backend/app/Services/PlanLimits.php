<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Per-plan feature limits — loaded from the `plan_limits` DB table so
 * they can be changed at runtime without a deployment.
 *
 * Convention used in the DB (and in the hardcoded fallbacks below):
 *   project_limit / profile_limit / word_limit = 0  → unlimited
 *   multi_voice  / data_export = boolean flag
 *
 * The table has one row per plan name: 'free', 'starter', 'pro'.
 * If a row is missing the hardcoded defaults below are used.
 */
class PlanLimits
{
    /** Per-request memory cache: plan → resolved config array. */
    private static array $cache = [];

    /**
     * Hardcoded fallback values that mirror the pricing page.
     * These are only used when the plan_limits table is empty / missing rows.
     */
    private static array $defaults = [
        'free' => [
            'project_limit' => 1,
            'profile_limit' => 1,
            'word_limit'    => 500,
            'multi_voice'   => false,
            'data_export'   => false,
        ],
        'starter' => [
            'project_limit' => 10,
            'profile_limit' => 5,
            'word_limit'    => 5000,
            'multi_voice'   => true,
            'data_export'   => false,
        ],
        'pro' => [
            'project_limit' => 0,   // 0 = unlimited
            'profile_limit' => 0,
            'word_limit'    => 0,
            'multi_voice'   => true,
            'data_export'   => true,
        ],
    ];

    /** Load and cache limits for one plan from DB, falling back to defaults. */
    public static function forPlan(string $plan): array
    {
        $key = $plan ?: 'free';

        if (! isset(self::$cache[$key])) {
            try {
                $row = DB::table('plan_limits')->where('plan', $key)->first();
            } catch (\Throwable) {
                $row = null; // table might not exist yet during migrations
            }

            self::$cache[$key] = $row
                ? [
                    'project_limit' => (int)  $row->project_limit,
                    'profile_limit' => (int)  $row->profile_limit,
                    'word_limit'    => (int)  $row->word_limit,
                    'multi_voice'   => (bool) $row->multi_voice,
                    'data_export'   => (bool) $row->data_export,
                ]
                : (self::$defaults[$key] ?? self::$defaults['free']);
        }

        return self::$cache[$key];
    }

    /** Load limits for a user's active plan. */
    public static function forUser(User $user): array
    {
        return self::forPlan($user->plan_name);
    }

    /**
     * Return the numeric limit for a given key (project_limit|profile_limit|word_limit).
     * 0 means unlimited (PHP_INT_MAX returned so callers can use >= comparisons directly).
     */
    public static function limit(User $user, string $key): int
    {
        $value = (int) (self::forUser($user)[$key] ?? 0);
        return $value === 0 ? PHP_INT_MAX : $value;
    }

    /** Return a boolean feature flag (multi_voice|data_export). */
    public static function allows(User $user, string $key): bool
    {
        return (bool) (self::forUser($user)[$key] ?? false);
    }

    /** Count words in script content. */
    public static function wordCount(?string $content): int
    {
        $content = trim((string) $content);
        return $content === '' ? 0 : count(preg_split('/\s+/', $content));
    }

    /** Upgrade hint appended to limit-exceeded messages. */
    public static function nextPlanHint(string $plan): string
    {
        return match ($plan) {
            'free'    => 'Upgrade to Starter or Pro',
            'starter' => 'Upgrade to Pro',
            default   => 'Upgrade your plan',
        };
    }

    /**
     * Return a human-readable limit string for display (e.g. "10" or "Unlimited").
     * Used by the plan limits API endpoint.
     */
    public static function displayLimit(int $rawValue): string
    {
        return $rawValue === 0 ? 'Unlimited' : (string) $rawValue;
    }

    /** Flush the per-request cache (useful in tests or after DB changes). */
    public static function flushCache(): void
    {
        self::$cache = [];
    }

    /**
     * Return all three plans' limits for the API endpoint.
     * This lets the frontend and admin panel read current DB values.
     */
    public static function all(): array
    {
        self::flushCache(); // always read fresh from DB when listing all plans

        return array_map(function (string $plan) {
            $cfg = self::forPlan($plan);
            return array_merge(['plan' => $plan], $cfg);
        }, ['free', 'starter', 'pro']);
    }
}
