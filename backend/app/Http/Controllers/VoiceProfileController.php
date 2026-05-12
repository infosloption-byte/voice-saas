<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

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
            // When called from the frontend after engine save (no file)
            // or when forwarding the file directly
            'file'       => 'nullable|file|mimes:webm,wav,ogg,mp3,m4a|max:51200',
        ]);

        $profileId = $validated['profile_id'];

        // If a file was uploaded, forward it to the AI engine
        if ($request->hasFile('file')) {
            $engineUrl = config('services.ai_engine.url', 'http://127.0.0.1:8000');

            try {
                $response = Http::timeout(60)
                    ->attach(
                        'file',
                        file_get_contents($request->file('file')->getRealPath()),
                        $request->file('file')->getClientOriginalName()
                    )
                    ->post("{$engineUrl}/voice-profile/save", [
                        'profile_id' => $profileId,
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
                'name'     => $validated['name'] ?? $profileId,
                'status'   => $validated['status'] ?? 'ready',
                'duration' => $duration ?? null,
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

        // Optionally tell the engine to remove the WAV file too
        // (engine doesn't have a delete endpoint by default — skip silently)

        $profile->delete();

        return response()->json(null, 204);
    }
}