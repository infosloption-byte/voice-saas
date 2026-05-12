<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;

class VoiceProfileController extends Controller
{
    public function index(Request $request)
    {
        return response()->json($request->user()->voiceProfiles);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'profile_id' => 'required|string',
            'name' => 'nullable|string',
            'status' => 'nullable|string',
        ]);

        $profile = $request->user()->voiceProfiles()->updateOrCreate(
            ['profile_id' => $validated['profile_id']],
            $validated
        );

        return response()->json($profile);
    }
    
    public function destroy(Request $request, string $id)
    {
        $profile = $request->user()->voiceProfiles()->where('profile_id', $id)->firstOrFail();
        $profile->delete();

        return response()->json(null, 204);
    }
}
