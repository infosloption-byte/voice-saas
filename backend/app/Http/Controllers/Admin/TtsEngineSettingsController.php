<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\TtsEngineSetting;
use App\Services\EngineResolver;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * Per-engine platform-wide availability toggles. Separate from
 * EngineConfigController (which swaps the entire ai-engine HOST) — this
 * controls which individual TTS engines (xtts/f5/chatterbox) are offered
 * to users at all, independent of raw technical reachability.
 */
class TtsEngineSettingsController extends Controller
{
    public function index()
    {
        $this->ensureSeeded();
        return response()->json(
            TtsEngineSetting::orderByRaw(
                "FIELD(engine, '" . implode("','", EngineResolver::SUPPORTED_TTS_ENGINES) . "')"
            )->get()
        );
    }

    public function update(Request $request, string $engine)
    {
        if (!in_array($engine, EngineResolver::SUPPORTED_TTS_ENGINES, true)) {
            return response()->json(['error' => "Unknown engine '{$engine}'."], 422);
        }

        $data = $request->validate([
            'enabled' => 'required|boolean',
        ]);

        // At least one engine must stay enabled, or every user (and the
        // guest trial flow) loses the ability to synthesize anything.
        $wouldDisableLast = !$data['enabled']
            && TtsEngineSetting::where('engine', '!=', $engine)->where('enabled', true)->doesntExist();
        if ($wouldDisableLast) {
            return response()->json(['error' => 'At least one TTS engine must remain enabled.'], 422);
        }

        $setting = TtsEngineSetting::updateOrCreate(['engine' => $engine], $data);
        Cache::forget('tts_engine_settings:enabled');

        return response()->json($setting);
    }

    /** Self-heal if the migration's seed rows were somehow lost, so this
     * never leaves the platform with zero configured engines. */
    private function ensureSeeded(): void
    {
        foreach (EngineResolver::SUPPORTED_TTS_ENGINES as $engine) {
            TtsEngineSetting::firstOrCreate(['engine' => $engine], ['enabled' => true]);
        }
    }
}
