<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Sends operational alerts to the Slack/Discord webhooks configured in
 * the admin panel. Each alert key is deduplicated so a persisting
 * condition doesn't spam the channel.
 */
class AlertNotifier
{
    private const DEDUPE_HOURS = 6;

    /** Send an alert unless the same key fired within the dedupe window. */
    public static function send(string $key, string $message): void
    {
        $cacheKey = "alert_sent:{$key}";
        if (Cache::has($cacheKey)) return;
        Cache::put($cacheKey, true, now()->addHours(self::DEDUPE_HOURS));

        $text = "🚨 Voxora alert: {$message}";

        if ($slack = Settings::get('slack_webhook_url')) {
            try {
                Http::timeout(10)->post($slack, ['text' => $text]);
            } catch (\Throwable $e) {
                Log::warning('Slack alert failed: ' . $e->getMessage());
            }
        }

        if ($discord = Settings::get('discord_webhook_url')) {
            try {
                Http::timeout(10)->post($discord, ['content' => $text]);
            } catch (\Throwable $e) {
                Log::warning('Discord alert failed: ' . $e->getMessage());
            }
        }
    }
}
