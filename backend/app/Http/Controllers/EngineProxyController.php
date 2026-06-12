<?php

namespace App\Http\Controllers;

use App\Services\EngineResolver;
use App\Services\GuestSynthQuota;
use App\Services\TranslationQuota;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

/**
 * Proxies the engine endpoints the frontend used to call directly (/ai/...).
 * The AI engine is now reachable only over the internal network; the engine
 * API key lives server-side and is injected here, never shipped to the browser.
 * Each method applies the appropriate auth / quota before forwarding.
 */
class EngineProxyController extends Controller
{
    private function engineUrl(): string
    {
        return rtrim(EngineResolver::activeUrl(), '/');
    }

    private function engineHeaders(): array
    {
        $key = config('services.ai_engine.key', '');
        return $key ? ['X-Engine-Key' => $key] : [];
    }

    private function user(Request $request)
    {
        if ($u = $request->user()) {
            return $u;
        }
        try {
            return auth('sanctum')->user();
        } catch (\Throwable) {
            return null;
        }
    }

    private function forwardMultipart(Request $request, string $path, int $timeout)
    {
        $pending = Http::withHeaders($this->engineHeaders())
            ->timeout($timeout)
            ->retry(2, 300, throw: false)
            ->asMultipart();

        foreach ($request->post() as $name => $value) {
            $pending = $pending->attach($name, (string) $value);
        }
        foreach ($request->allFiles() as $name => $file) {
            $pending = $pending->attach(
                $name,
                file_get_contents($file->getRealPath()),
                $file->getClientOriginalName(),
                ['Content-Type' => $file->getMimeType()]
            );
        }

        $resp        = $pending->post($this->engineUrl() . $path);
        $contentType = $resp->header('Content-Type') ?? 'application/octet-stream';

        return response($resp->body(), $resp->status())->header('Content-Type', $contentType);
    }

    /**
     * POST /api/engine/clone-voice — one-shot voice cloning (GPU synthesis).
     * Used for guest generation, previews, and voice-profile tests. Guests are
     * capped server-side by IP for `purpose=generate`; everyone is throttled.
     */
    public function cloneVoice(Request $request)
    {
        $user    = $this->user($request);
        $purpose = (string) $request->input('purpose', 'generate');

        if (! $user && $purpose === 'generate') {
            $ip = $request->ip();
            if (! GuestSynthQuota::hasRemaining($ip)) {
                return response()->json([
                    'detail'  => 'Guest synthesis limit reached. Sign up for more.',
                    'message' => 'Guest synthesis limit reached. Sign up for more.',
                    'code'    => 'guest_limit_synth',
                ], 429);
            }
            GuestSynthQuota::record($ip);
        }

        return $this->forwardMultipart($request, '/clone-voice', 120);
    }

    /**
     * POST /api/engine/translate — text translation (Gemini).
     * Enforces + records the user's translation quota server-side.
     */
    public function translate(Request $request)
    {
        $user = $this->user($request);

        if ($user) {
            $exceeded = TranslationQuota::checkAndRecord($user);
            if ($exceeded !== null) {
                return response()->json($exceeded + ['detail' => $exceeded['message']], 429);
            }
        }

        try {
            // Gemini key is managed in the admin panel (stored encrypted in
            // the DB) and injected per-request, so rotating it needs no
            // engine .env change or restart.
            $headers = $this->engineHeaders();
            if ($gemini = \App\Services\Settings::get('gemini_api_key')) {
                $headers['X-Gemini-Key'] = $gemini;
            }
            $resp = Http::withHeaders($headers)
                ->timeout(60)
                ->retry(2, 300, throw: false)
                ->post($this->engineUrl() . '/translate', $request->json()->all() ?: $request->all());

            return response($resp->body(), $resp->status())
                ->header('Content-Type', 'application/json');
        } catch (\Throwable $e) {
            return response()->json(['detail' => 'Engine proxy error: ' . $e->getMessage()], 502);
        }
    }

    /** POST /api/engine/transcribe — speech-to-text (auth required). */
    public function transcribe(Request $request)
    {
        return $this->forwardMultipart($request, '/transcribe', 120);
    }

    /** POST /api/engine/export-mp3 — WAV→MP3 conversion (auth required). */
    public function exportMp3(Request $request)
    {
        return $this->forwardMultipart($request, '/export/mp3', 120);
    }

    /** GET /api/engine/voice-preview/{speaker} — public built-in voice preview. */
    public function voicePreview(Request $request, string $speaker)
    {
        try {
            $resp = Http::withHeaders($this->engineHeaders())
                ->timeout(60)
                ->get($this->engineUrl() . '/voice-preview/' . rawurlencode($speaker));

            return response($resp->body(), $resp->status())
                ->header('Content-Type', $resp->header('Content-Type') ?? 'audio/wav');
        } catch (\Throwable $e) {
            return response()->json(['detail' => 'Engine proxy error: ' . $e->getMessage()], 502);
        }
    }

    /**
     * GET /api/engine/voice-profile/{id}/preview — stream a user's own
     * cloned-voice reference clip. Ownership is enforced via the DB: the
     * engine_key must belong to one of the caller's profiles.
     */
    public function voiceProfilePreview(Request $request, string $id)
    {
        // voiceProfiles() is already scoped to the authenticated user.
        $owns = $request->user()->voiceProfiles()
            ->where(fn ($q) => $q->where('engine_key', $id)->orWhere('profile_id', $id))
            ->exists();

        if (! $owns) {
            return response()->json(['detail' => 'Voice profile not found.'], 404);
        }

        try {
            $resp = Http::withHeaders($this->engineHeaders())
                ->timeout(30)
                ->get($this->engineUrl() . '/voice-profile/' . rawurlencode($id) . '/preview');

            return response($resp->body(), $resp->status())
                ->header('Content-Type', $resp->header('Content-Type') ?? 'audio/wav');
        } catch (\Throwable $e) {
            return response()->json(['detail' => 'Engine proxy error: ' . $e->getMessage()], 502);
        }
    }
}
