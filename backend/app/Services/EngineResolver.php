<?php

namespace App\Services;

use App\Models\EngineConfig;
use Illuminate\Support\Facades\Cache;

class EngineResolver
{
    /**
     * Single source of truth for which TTS engine names the platform
     * accepts. Was previously hardcoded as 'in:xtts,f5' in 4 separate
     * places (EngineSynthesisProxyController + 3x ScriptController) —
     * adding Chatterbox here means adding it once instead of 4 times,
     * and the next engine addition only needs this one line.
     */
    public const SUPPORTED_TTS_ENGINES = ['xtts', 'f5', 'chatterbox'];

    /** Laravel validation rule fragment: 'in:xtts,f5,chatterbox'. */
    public static function engineValidationRule(): string
    {
        return 'in:' . implode(',', self::SUPPORTED_TTS_ENGINES);
    }

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
