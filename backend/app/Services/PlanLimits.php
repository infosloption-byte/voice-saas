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
        'guest' => [
            'project_limit' => 1,
            'profile_limit' => 2,
            'word_limit'    => 100,
            'multi_voice'   => false,
            'data_export'   => false,
            'synth_limit'   => 1,
            'preview_limit' => 2,
            'script_limit'  => 3,
            'session_days'  => 7,
        ],
        'free' => [
            'project_limit'    => 1,
            'profile_limit'    => 1,
            'word_limit'       => 500,
            'multi_voice'      => false,
            'data_export'      => false,
            'synth_limit'      => 3,
            'synth_period'     => 'day',
            'translate_limit'  => 10,
            'translate_period' => 'month',
        ],
        'starter' => [
            'project_limit'    => 10,
            'profile_limit'    => 5,
            'word_limit'       => 5000,
            'multi_voice'      => true,
            'data_export'      => false,
            'synth_limit'      => 100,
            'synth_period'     => 'month',
            'translate_limit'  => 50,
            'translate_period' => 'month',
        ],
        'pro' => [
            'project_limit'    => 0,   // 0 = unlimited
            'profile_limit'    => 0,
            'word_limit'       => 0,
            'multi_voice'      => true,
            'data_export'      => true,
            'synth_limit'      => 0,
            'synth_period'     => 'month',
            'translate_limit'  => 0,   // unlimited
            'translate_period' => 'month',
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
                    // NULL is preserved (not cast to 0) so a NULL shared column
                    // means "inherit from another tier" rather than "unlimited".
                    'project_limit' => isset($row->project_limit) ? (int) $row->project_limit : null,
                    'profile_limit' => isset($row->profile_limit) ? (int) $row->profile_limit : null,
                    'word_limit'    => isset($row->word_limit)    ? (int) $row->word_limit    : null,
                    'multi_voice'   => (bool) $row->multi_voice,
                    'data_export'   => (bool) $row->data_export,
                    // Guest-specific session knobs
                    'preview_limit' => isset($row->preview_limit) ? (int) $row->preview_limit : null,
                    'script_limit'  => isset($row->script_limit)  ? (int) $row->script_limit  : null,
                    'session_days'  => isset($row->session_days)  ? (int) $row->session_days  : null,
                    // Synthesis quota (all tiers)
                    'synth_limit'      => isset($row->synth_limit)      ? (int) $row->synth_limit      : null,
                    'synth_period'     => $row->synth_period ?? null,
                    // Translation quota (all tiers)
                    'translate_limit'  => isset($row->translate_limit)  ? (int) $row->translate_limit  : null,
                    'translate_period' => $row->translate_period ?? null,
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

    /** Shorthand aliases accepted by limit() so callers can use either form. */
    private const LIMIT_ALIASES = [
        'projects' => 'project_limit',
        'profiles' => 'profile_limit',
        'words'    => 'word_limit',
    ];

    /**
     * Return the numeric limit for a given key. Accepts either the canonical
     * column name (project_limit|profile_limit|word_limit) or the shorthand
     * (projects|profiles|words).
     *
     * 0 means unlimited (PHP_INT_MAX returned so callers can use >= directly).
     * NULL means "inherit" — the value is taken from the free tier (this is how
     * guest shared limits defer to free).
     */
    public static function limit(User $user, string $key): int
    {
        $key   = self::LIMIT_ALIASES[$key] ?? $key;
        $value = self::forUser($user)[$key] ?? null;

        // NULL = inherit from the free tier (e.g. guest shared columns)
        if ($value === null) {
            $value = self::forPlan('free')[$key] ?? null;
        }

        $value = (int) ($value ?? 0);
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
     * Return all plans' limits for the API/admin endpoint (guest + paid tiers).
     */
    public static function all(): array
    {
        self::flushCache(); // always read fresh from DB when listing all plans

        return array_map(function (string $plan) {
            $cfg = self::forPlan($plan);
            return array_merge(['plan' => $plan], $cfg);
        }, ['guest', 'free', 'starter', 'pro']);
    }

    /**
     * Guest limits in the legacy shape expected by the frontend
     * (GET /api/guest-limits). Reads the 'guest' row of plan_limits.
     */
    public static function guestLimits(): array
    {
        $guest = self::forPlan('guest');
        $free  = self::forPlan('free');
        $gd    = self::$defaults['guest'];
        $fd    = self::$defaults['free'];

        return [
            // Session-specific knobs come from the guest row
            'synth_limit'   => $guest['synth_limit']   ?? $gd['synth_limit'],
            'preview_limit' => $guest['preview_limit'] ?? $gd['preview_limit'],
            'script_limit'  => $guest['script_limit']  ?? $gd['script_limit'],
            'session_days'  => $guest['session_days']  ?? $gd['session_days'],
            // Shared feature limits inherit from the free tier when the guest
            // column is NULL — so non-paying limits live in one place (free).
            'word_limit'    => $guest['word_limit']    ?? $free['word_limit']    ?? $fd['word_limit'],
            'profile_limit' => $guest['profile_limit'] ?? $free['profile_limit'] ?? $fd['profile_limit'],
        ];
    }
}
