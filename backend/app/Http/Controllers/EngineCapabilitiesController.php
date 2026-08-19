<?php

namespace App\Http\Controllers;

use App\Models\TtsEngineSetting;
use App\Services\EngineResolver;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

class EngineCapabilitiesController extends Controller
{
    public function show()
    {
        $url = EngineResolver::activeUrl();

        // Real, technical reachability — reported by ai-engine itself.
        $reachable = ['xtts' => false, 'f5' => false, 'chatterbox' => false];
        $f5Languages = [];
        $chatterboxLanguages = [];

        try {
            $resp = Http::timeout(8)->get("{$url}/");
            if ($resp->successful()) {
                $engines = $resp->json('engines') ?? [];
                $reachable = [
                    'xtts'       => ($engines['xtts'] ?? false) === true,
                    'f5'         => ($engines['f5'] ?? false) === true,
                    'chatterbox' => ($engines['chatterbox'] ?? false) === true,
                ];
                $f5Languages = array_values(array_filter((array) ($engines['f5_languages'] ?? []), 'is_string'));
                $chatterboxLanguages = array_values(array_filter((array) ($engines['chatterbox_languages'] ?? []), 'is_string'));
            }
        } catch (\Throwable) {
            // reachable stays all-false; falls through below
        }

        // Admin-controlled, platform-wide "should this even be offered"
        // gate — independent of raw reachability. Cached briefly since
        // this endpoint is polled fairly often by the frontend.
        $enabled = Cache::remember('tts_engine_settings:enabled', 30, function () {
            $rows = TtsEngineSetting::pluck('enabled', 'engine');
            // Default an engine to enabled if no row exists yet (e.g. a
            // fresh install before the seed migration ran) — matches the
            // pre-this-feature behavior of "no admin gate at all".
            $out = [];
            foreach (EngineResolver::SUPPORTED_TTS_ENGINES as $engine) {
                $out[$engine] = $rows->has($engine) ? (bool) $rows[$engine] : true;
            }
            return $out;
        });

        // An engine only reaches the user if it's BOTH admin-enabled AND
        // actually reachable — either signal alone isn't enough.
        $xtts       = $reachable['xtts']       && $enabled['xtts'];
        $f5         = $reachable['f5']         && $enabled['f5'];
        $chatterbox = $reachable['chatterbox'] && $enabled['chatterbox'];

        return response()->json([
            'xtts'                 => $xtts,
            'f5'                   => $f5,
            'f5_languages'         => $f5 ? $f5Languages : [],
            'chatterbox'           => $chatterbox,
            'chatterbox_languages' => $chatterbox ? $chatterboxLanguages : [],
        ]);
    }
}
