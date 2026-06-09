<?php

namespace App\Services;

use App\Models\EngineConfig;
use Illuminate\Support\Facades\Cache;

class EngineResolver
{
    /**
     * Return the URL of the currently active AI engine.
     * Cached in Redis for 30 seconds to avoid a DB hit on every request.
     */
    public static function activeUrl(): string
    {
        return Cache::remember('engine:active_url', 30, function () {
            $cfg = EngineConfig::where('is_active', true)->first();
            return $cfg?->url ?? config('services.ai_engine.url', 'http://ai-engine:8000');
        });
    }

    /**
     * Bust the cache after activating a different engine.
     */
    public static function bust(): void
    {
        Cache::forget('engine:active_url');
    }
}
