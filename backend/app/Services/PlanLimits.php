<?php

namespace App\Services;

use App\Models\User;

/**
 * Single source of truth for per-plan feature limits.
 *
 * Values mirror what the pricing page advertises:
 *   Free    — 1 project,  1 profile,  500 words/script,  no multi-voice, no data export
 *   Starter — 10 projects, 5 profiles, 5,000 words/script, multi-voice,   no data export
 *   Pro     — unlimited everything + multi-voice + GDPR data export
 *
 * Synthesis-count quotas (3/day, 100/mo) are NOT enforced here — that
 * requires a usage-tracking table and is intentionally out of scope.
 */
class PlanLimits
{
    private const UNLIMITED = PHP_INT_MAX;

    private const LIMITS = [
        'free' => [
            'projects'    => 1,
            'profiles'    => 1,
            'words'       => 500,
            'multi_voice' => false,
            'data_export' => false,
        ],
        'starter' => [
            'projects'    => 10,
            'profiles'    => 5,
            'words'       => 5000,
            'multi_voice' => true,
            'data_export' => false,
        ],
        'pro' => [
            'projects'    => self::UNLIMITED,
            'profiles'    => self::UNLIMITED,
            'words'       => self::UNLIMITED,
            'multi_voice' => true,
            'data_export' => true,
        ],
    ];

    /** Resolve the full limit set for a plan name (defaults to free). */
    public static function forPlan(string $plan): array
    {
        return self::LIMITS[$plan] ?? self::LIMITS['free'];
    }

    /** Resolve the full limit set for a user based on their active plan. */
    public static function forUser(User $user): array
    {
        return self::forPlan($user->plan_name);
    }

    /** Numeric limit for a given key (projects|profiles|words). */
    public static function limit(User $user, string $key): int
    {
        return self::forUser($user)[$key] ?? 0;
    }

    /** Boolean feature flag for a given key (multi_voice|data_export). */
    public static function allows(User $user, string $key): bool
    {
        return (bool) (self::forUser($user)[$key] ?? false);
    }

    /** Count words in a piece of script content. */
    public static function wordCount(?string $content): int
    {
        $content = trim((string) $content);
        if ($content === '') {
            return 0;
        }
        return count(preg_split('/\s+/', $content));
    }

    /** Human-readable label for a plan (for upgrade messages). */
    public static function nextPlanHint(string $plan): string
    {
        return match ($plan) {
            'free'    => 'Upgrade to Starter or Pro',
            'starter' => 'Upgrade to Pro',
            default   => 'Upgrade your plan',
        };
    }
}
