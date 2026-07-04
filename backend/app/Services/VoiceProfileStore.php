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
    /** Must match MAX_PROFILE_CLIPS in ai-engine/main.py. */
    public const MAX_CLIPS = 4;

    /**
     * S3 (or other shared disk) key for a profile's reference audio.
     *
     * $index is null for the legacy single-clip layout (kept so old
     * profiles saved before multi-clip support still resolve). When a
     * profile has 2+ clips they're stored individually as 0, 1, 2...
     */
    public static function objectKey(string $engineKey, ?int $index = null): string
    {
        return $index === null
            ? "voice-profiles/{$engineKey}"
            : "voice-profiles/{$engineKey}/{$index}";
    }

    /** Is a shared disk actually configured? (skip silently in local dev) */
    public static function enabled(): bool
    {
        return (bool) config('filesystems.disks.s3.bucket');
    }

    /**
     * Persist one or more uploaded reference clips to shared storage.
     * Best-effort — accepts either a single UploadedFile (legacy call sites)
     * or an array of up to MAX_CLIPS files.
     */
    public static function put(string $engineKey, UploadedFile|array $files): void
    {
        if (! self::enabled()) {
            return;
        }

        $files = is_array($files) ? array_slice($files, 0, self::MAX_CLIPS) : [$files];

        try {
            // Always keep clip 0 under the legacy unindexed key too, so
            // profiles saved before this change (and any code path that
            // still calls objectKey() with no index) keep working.
            Storage::disk('s3')->put(
                self::objectKey($engineKey),
                file_get_contents($files[0]->getRealPath())
            );

            if (count($files) > 1) {
                foreach ($files as $i => $file) {
                    Storage::disk('s3')->put(
                        self::objectKey($engineKey, $i),
                        file_get_contents($file->getRealPath())
                    );
                }
            }
        } catch (\Throwable $e) {
            // Non-fatal: the engine still has its local copy for now.
            Log::warning('VoiceProfileStore: failed to write to shared storage', [
                'engine_key' => $engineKey,
                'error'      => $e->getMessage(),
            ]);
        }
    }

    /** Remove a profile's reference audio (all clips) from shared storage. Best-effort. */
    public static function delete(string $engineKey): void
    {
        if (! self::enabled()) {
            return;
        }

        try {
            $keys = [self::objectKey($engineKey)];
            for ($i = 0; $i < self::MAX_CLIPS; $i++) {
                $keys[] = self::objectKey($engineKey, $i);
            }
            Storage::disk('s3')->delete($keys);
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
            // Gather every stored clip (indexed 0..MAX_CLIPS-1) if present;
            // fall back to the single legacy unindexed copy for profiles
            // saved before multi-clip support existed.
            $disk  = Storage::disk('s3');
            $blobs = [];
            for ($i = 0; $i < self::MAX_CLIPS; $i++) {
                $key = self::objectKey($engineKey, $i);
                if ($disk->exists($key)) {
                    $blobs[] = $disk->get($key);
                }
            }
            if (empty($blobs)) {
                $blobs[] = $disk->get(self::objectKey($engineKey));
            }

            $request = Http::timeout(60)->withHeaders($headers);
            foreach ($blobs as $i => $bytes) {
                $request = $request->attach('file', $bytes, "{$engineKey}_{$i}.audio");
            }
            $resp = $request->post("{$engineUrl}/voice-profile/save", ['profile_id' => $engineKey]);

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
