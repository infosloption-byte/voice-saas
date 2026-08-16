<?php

namespace App\Http\Controllers;

use App\Services\EngineResolver;
use Illuminate\Support\Facades\Http;

class EngineCapabilitiesController extends Controller
{
    public function show()
    {
        $url = EngineResolver::activeUrl();

        try {
            $resp = Http::timeout(8)->get("{$url}/");
            if ($resp->successful()) {
                $engines = $resp->json('engines') ?? [];
                return response()->json([
                    'xtts'         => ($engines['xtts'] ?? false) === true,
                    'f5'           => ($engines['f5']   ?? false) === true,
                    'f5_languages' => array_values(array_filter(
                        (array) ($engines['f5_languages'] ?? []),
                        'is_string'
                    )),
                    'chatterbox'           => ($engines['chatterbox'] ?? false) === true,
                    'chatterbox_languages' => array_values(array_filter(
                        (array) ($engines['chatterbox_languages'] ?? []),
                        'is_string'
                    )),
                ]);
            }
        } catch (\Throwable) {
            // fall through to offline defaults
        }

        return response()->json([
            'xtts' => false, 'f5' => false, 'f5_languages' => [],
            'chatterbox' => false, 'chatterbox_languages' => [],
        ]);
    }
}
