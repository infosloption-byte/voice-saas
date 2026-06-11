<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;

/**
 * Server-side guest synthesis quota, keyed by client IP for the day.
 *
 * Guests have no account, so this is best-effort abuse prevention (a
 * determined user can change IP) layered on top of route throttling. It
 * closes the trivial "edit localStorage" bypass of the client-side counter.
 */
class GuestSynthQuota
{
    private static function key(string $ip): string
    {
        return 'guest_synth:' . $ip . ':' . now()->format('Y-m-d');
    }

    /** Configured daily guest synthesis allowance (0 = unlimited). */
    public static function limit(): int
    {
        $limits = PlanLimits::guestLimits();
        return (int) ($limits['synth_limit'] ?? 1);
    }

    public static function used(string $ip): int
    {
        return (int) Cache::get(self::key($ip), 0);
    }

    public static function hasRemaining(string $ip): bool
    {
        $limit = self::limit();
        return $limit === 0 || self::used($ip) < $limit;
    }

    /** Increment the guest's usage for today (TTL ~26h to cover the day). */
    public static function record(string $ip): void
    {
        $key = self::key($ip);
        Cache::add($key, 0, now()->addHours(26)); // ensure the key exists
        Cache::increment($key);
    }
}
