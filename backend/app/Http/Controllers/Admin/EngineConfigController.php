<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\EngineConfig;
use App\Services\EngineResolver;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class EngineConfigController extends Controller
{
    public function index()
    {
        return response()->json(EngineConfig::orderBy('id')->get());
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => 'required|string|max:80',
            'url'  => 'required|url|max:255',
        ]);

        $config = EngineConfig::create(array_merge($data, [
            'is_active' => false,
            'status'    => 'unknown',
        ]));

        return response()->json($config, 201);
    }

    public function update(Request $request, EngineConfig $engineConfig)
    {
        $data = $request->validate([
            'name' => 'sometimes|string|max:80',
            'url'  => 'sometimes|url|max:255',
        ]);

        $engineConfig->update($data);
        EngineResolver::bust();

        return response()->json($engineConfig);
    }

    public function destroy(EngineConfig $engineConfig)
    {
        if ($engineConfig->is_active) {
            return response()->json(['error' => 'Cannot delete the active engine.'], 422);
        }

        $engineConfig->delete();

        return response()->json(null, 204);
    }

    public function activate(EngineConfig $engineConfig)
    {
        EngineConfig::query()->update(['is_active' => false]);
        $engineConfig->update(['is_active' => true]);
        EngineResolver::bust();

        return response()->json($engineConfig);
    }

    public function test(EngineConfig $engineConfig)
    {
        $start = microtime(true);
        try {
            $resp = Http::timeout(8)->get("{$engineConfig->url}/");
            $ms   = (int) round((microtime(true) - $start) * 1000);
            $ok   = $resp->successful();
        } catch (\Throwable) {
            $ms = null;
            $ok = false;
        }

        $engineConfig->update([
            'status'         => $ok ? 'online' : 'offline',
            'latency_ms'     => $ms,
            'last_tested_at' => now(),
        ]);

        return response()->json($engineConfig);
    }
}
