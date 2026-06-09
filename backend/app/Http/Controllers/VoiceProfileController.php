<?php

namespace App\Http\Controllers;

use App\Services\EngineResolver;
use App\Services\PlanLimits;
use App\Services\VoiceProfileStore;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class VoiceProfileController extends Controller
{
    /**
     * List all voice profiles for the authenticated user.
     */
    public function index(Request $request)
    {
        return response()->json($request->user()->voiceProfiles);
    }

    /**
     * Save a voice recording:
     *  1. Forward the audio file to the AI engine's /voice-profile/save
     *  2. Persist metadata in the Laravel database
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'profile_id' => 'required|string|max:100',
            'name'       => 'nullable|string|max:255',
            'status'     => 'nullable|string|max:50',
            // Use a custom closure instead of `mimes` because browsers send
            // audio/webm;codecs=opus which Laravel's mimes rule doesn't recognise.
            // The closure checks the actual detected MIME and the client-sent MIME.
            'file'       => [
                'nullable',
                'file',
                'max:51200',
                function ($attribute, $value, $fail) {
                    if (! $value) {
                        return; // no file is fine — metadata-only update
                    }

                    $allowed = [
                        'audio/webm',
                        'video/webm',   // Chrome sometimes labels webm recordings as video/webm
                        'audio/ogg',
                        'application/ogg',
                        'audio/wav',
                        'audio/wave',
                        'audio/x-wav',
                        'audio/mpeg',
                        'audio/mp3',
                        'audio/mp4',
                        'audio/m4a',
                        'audio/x-m4a',
                    ];

                    // getMimeType() reads the actual file bytes (finfo); getClientMimeType() is
                    // what the browser declared — check both so either can satisfy the rule.
                    $detectedMime = $value->getMimeType() ?? '';
                    $clientMime   = $value->getClientMimeType() ?? '';

                    foreach ([$detectedMime, $clientMime] as $mime) {
                        // Accept anything that starts with audio/
                        if (str_starts_with($mime, 'audio/')) {
                            return;
                        }
                        // Also accept video/webm (Chrome's label for audio-only webm)
                        if (in_array($mime, $allowed, true)) {
                            return;
                        }
                    }

                    $fail(
                        "The file field must be an audio file. " .
                        "Received: detected={$detectedMime}, client={$clientMime}. " .
                        "Supported: webm, wav, ogg, mp3, m4a."
                    );
                },
            ],
        ]);

        $profileId = $validated['profile_id'];

        // Resolve or generate a globally unique engine storage key.
        // engine_key is a UUID used as the filename on the AI engine — it is
        // namespaced per-record so two users cannot overwrite each other's files.
        $existingProfile = $request->user()->voiceProfiles()
            ->where('profile_id', $profileId)
            ->first();

        // Enforce per-plan profile count, but only when creating a NEW profile
        // (re-saving / updating an existing profile must always be allowed).
        if (! $existingProfile) {
            $user  = $request->user();
            $limit = PlanLimits::limit($user, 'profiles');

            if ($user->voiceProfiles()->count() >= $limit) {
                return response()->json([
                    'message' => "You've reached your plan's limit of {$limit} voice profile"
                        . ($limit === 1 ? '' : 's') . '. ' . PlanLimits::nextPlanHint($user->plan_name) . ' for more.',
                    'code'    => 'plan_limit_profiles',
                    'limit'   => $limit,
                ], 422);
            }
        }

        $engineKey = $existingProfile?->engine_key ?? (string) Str::uuid();

        // If a file was uploaded, forward it to the AI engine
        if ($request->hasFile('file')) {
            $engineUrl = EngineResolver::activeUrl();
            $engineApiKey = config('services.ai_engine.key', '');

            try {
                $file     = $request->file('file');
                $fileName = $file->getClientOriginalName() ?: 'voice.webm';

                $response = Http::timeout(60)
                    ->withHeaders($engineApiKey ? ['X-Engine-Key' => $engineApiKey] : [])
                    ->attach(
                        'file',
                        file_get_contents($file->getRealPath()),
                        $fileName
                    )
                    ->post("{$engineUrl}/voice-profile/save", [
                        'profile_id' => $engineKey,
                    ]);

                if (! $response->successful()) {
                    Log::error('AI engine voice-profile/save failed', [
                        'status' => $response->status(),
                        'body'   => $response->body(),
                    ]);
                    return response()->json([
                        'message' => 'AI engine failed to save voice profile: ' . $response->body(),
                    ], 502);
                }

                $engineData = $response->json();
                $duration   = $engineData['duration_seconds'] ?? null;

                // Keep a copy in shared storage so the profile can be used on
                // any engine, not just the one that was active at save time.
                VoiceProfileStore::put($engineKey, $file);

            } catch (\Exception $e) {
                Log::error('AI engine connection error', ['error' => $e->getMessage()]);
                return response()->json([
                    'message' => 'Could not reach AI engine: ' . $e->getMessage(),
                ], 503);
            }
        } else {
            $duration = null;
        }

        // Upsert profile metadata in the database (one row per user+profile_id)
        $profile = $request->user()->voiceProfiles()->updateOrCreate(
            ['profile_id' => $profileId],
            [
                'engine_key' => $engineKey,
                'name'       => $validated['name'] ?? $profileId,
                'status'     => $validated['status'] ?? 'ready',
                'duration'   => $duration ?? null,
            ]
        );

        return response()->json($profile, 201);
    }

    /**
     * Delete a voice profile from DB (and optionally from the engine).
     */
    public function destroy(Request $request, string $profileId)
    {
        $profile = $request->user()
            ->voiceProfiles()
            ->where('profile_id', $profileId)
            ->firstOrFail();

        // Remove the voice file from the AI engine (best-effort, non-fatal)
        if ($profile->engine_key) {
            $engineUrl    = EngineResolver::activeUrl();
            $engineApiKey = config('services.ai_engine.key', '');
            Http::withHeaders($engineApiKey ? ['X-Engine-Key' => $engineApiKey] : [])
                ->timeout(10)
                ->delete("{$engineUrl}/voice-profile/{$profile->engine_key}");

            // Also remove the shared copy.
            VoiceProfileStore::delete($profile->engine_key);
        }

        $profile->delete();

        return response()->json(null, 204);
    }
}