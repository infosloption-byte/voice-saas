<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Shared, engine-agnostic storage for voice-profile reference audio.
 *
 * Each AI engine keeps voice WAVs on its own local disk, so a profile saved
 * while engine A was active is invisible to engine B. To make profiles work
 * no matter which engine is active, we keep a copy of the source recording in
 * shared object storage (S3) keyed by the profile's engine_key, and lazily
 * push it onto whichever engine is handling a synthesis request.
 */
class VoiceProfileStore
{
    /** S3 (or other shared disk) key for a profile's reference audio. */
    public static function objectKey(string $engineKey): string
    {
        return "voice-profiles/{$engineKey}";
    }

    /** Is a shared disk actually configured? (skip silently in local dev) */
    public static function enabled(): bool
    {
        return (bool) config('filesystems.disks.s3.bucket');
    }

    /** Persist the uploaded reference audio to shared storage. Best-effort. */
    public static function put(string $engineKey, UploadedFile $file): void
    {
        if (! self::enabled()) {
            return;
        }

        try {
            Storage::disk('s3')->put(
                self::objectKey($engineKey),
                file_get_contents($file->getRealPath())
            );
        } catch (\Throwable $e) {
            // Non-fatal: the engine still has its local copy for now.
            Log::warning('VoiceProfileStore: failed to write to shared storage', [
                'engine_key' => $engineKey,
                'error'      => $e->getMessage(),
            ]);
        }
    }

    /** Remove a profile's reference audio from shared storage. Best-effort. */
    public static function delete(string $engineKey): void
    {
        if (! self::enabled()) {
            return;
        }

        try {
            Storage::disk('s3')->delete(self::objectKey($engineKey));
        } catch (\Throwable $e) {
            Log::warning('VoiceProfileStore: failed to delete from shared storage', [
                'engine_key' => $engineKey,
                'error'      => $e->getMessage(),
            ]);
        }
    }

    /**
     * Make sure the given engine has the profile's reference audio on its
     * local disk. If the engine is missing it, pull the WAV from shared
     * storage and push it to the engine's /voice-profile/save endpoint.
     *
     * Returns true if the engine has (or now has) the profile, false if it
     * could not be provisioned (e.g. no shared copy exists — a profile
     * recorded before shared storage was introduced).
     */
    public static function ensureOnEngine(string $engineUrl, string $engineKey): bool
    {
        $engineUrl = rtrim($engineUrl, '/');
        $apiKey    = config('services.ai_engine.key', '');
        $headers   = $apiKey ? ['X-Engine-Key' => $apiKey] : [];

        // 1. Does the engine already have it?
        try {
            $list = Http::timeout(10)->withHeaders($headers)->get("{$engineUrl}/voice-profile/list");
            if ($list->successful()) {
                $ids = collect($list->json('profiles') ?? [])->pluck('profile_id')->all();
                if (in_array($engineKey, $ids, true)) {
                    return true;
                }
            }
        } catch (\Throwable $e) {
            Log::warning('VoiceProfileStore: engine list check failed', ['error' => $e->getMessage()]);
            // Fall through and try to provision anyway.
        }

        // 2. Engine is missing it — provision from shared storage.
        if (! self::enabled() || ! Storage::disk('s3')->exists(self::objectKey($engineKey))) {
            return false;
        }

        try {
            $bytes = Storage::disk('s3')->get(self::objectKey($engineKey));

            $resp = Http::timeout(60)
                ->withHeaders($headers)
                ->attach('file', $bytes, "{$engineKey}.audio")
                ->post("{$engineUrl}/voice-profile/save", ['profile_id' => $engineKey]);

            return $resp->successful();
        } catch (\Throwable $e) {
            Log::error('VoiceProfileStore: failed to provision profile onto engine', [
                'engine_key' => $engineKey,
                'engine_url' => $engineUrl,
                'error'      => $e->getMessage(),
            ]);
            return false;
        }
    }
}
