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
                    'xtts' => ($engines['xtts'] ?? false) === true,
                    'f5'   => ($engines['f5']   ?? false) === true,
                ]);
            }
        } catch (\Throwable) {
            // fall through to offline defaults
        }

        return response()->json(['xtts' => false, 'f5' => false]);
    }
}
