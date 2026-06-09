<?php

namespace App\Http\Controllers;

use App\Services\EngineResolver;
use App\Services\VoiceProfileStore;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class EngineSynthesisProxyController extends Controller
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

    /**
     * Make sure every voice profile referenced by this request is present on
     * the active engine, provisioning from shared storage if needed. Covers
     * the single `profile_id` field and any engine_keys inside `speaker_map`.
     */
    private function ensureProfiles(Request $request, string $engineUrl): void
    {
        $keys = [];

        if ($pid = $request->input('profile_id')) {
            $keys[] = $pid;
        }

        if ($map = $request->input('speaker_map')) {
            $decoded = is_string($map) ? json_decode($map, true) : $map;
            if (is_array($decoded)) {
                foreach ($decoded as $engineKey) {
                    if (is_string($engineKey)) {
                        $keys[] = $engineKey;
                    }
                }
            }
        }

        foreach (array_unique($keys) as $key) {
            VoiceProfileStore::ensureOnEngine($engineUrl, $key);
        }
    }

    /** POST /api/engine/synthesize/submit  — forward multipart to the active engine */
    public function submit(Request $request)
    {
        $engineUrl = $this->engineUrl();
        $url       = $engineUrl . '/synthesize/submit';

        try {
            $this->ensureProfiles($request, $engineUrl);

            $pending = Http::timeout(30)
                ->withHeaders($this->engineHeaders())
                ->asMultipart();

            // Rebuild the multipart fields from the incoming request
            foreach ($request->post() as $name => $value) {
                $pending = $pending->attach($name, (string) $value);
            }

            // Forward any uploaded files
            foreach ($request->allFiles() as $name => $file) {
                $pending = $pending->attach(
                    $name,
                    file_get_contents($file->getRealPath()),
                    $file->getClientOriginalName(),
                    ['Content-Type' => $file->getMimeType()]
                );
            }

            $resp = $pending->post($url);

            return response($resp->body(), $resp->status())
                ->header('Content-Type', 'application/json');
        } catch (\Throwable $e) {
            return response()->json(['detail' => 'Engine proxy error: ' . $e->getMessage()], 502);
        }
    }

    /** GET /api/engine/synthesize/status/{jobId} */
    public function status(Request $request, string $jobId)
    {
        $url = $this->engineUrl() . '/synthesize/status/' . $jobId;

        try {
            $resp = Http::timeout(10)
                ->withHeaders($this->engineHeaders())
                ->get($url);

            return response($resp->body(), $resp->status())
                ->header('Content-Type', 'application/json');
        } catch (\Throwable $e) {
            return response()->json(['detail' => 'Engine proxy error: ' . $e->getMessage()], 502);
        }
    }

    /** GET /api/engine/synthesize/result/{jobId} */
    public function result(Request $request, string $jobId)
    {
        $url = $this->engineUrl() . '/synthesize/result/' . $jobId;

        try {
            $resp = Http::timeout(120)
                ->withOptions(['stream' => true])
                ->withHeaders($this->engineHeaders())
                ->get($url);

            $body        = $resp->body();
            $contentType = $resp->header('Content-Type') ?? 'audio/wav';
            $status      = $resp->status();

            return response($body, $status)->header('Content-Type', $contentType);
        } catch (\Throwable $e) {
            return response()->json(['detail' => 'Engine proxy error: ' . $e->getMessage()], 502);
        }
    }

    /** POST /api/engine/synthesize  — legacy synchronous path */
    public function legacy(Request $request)
    {
        $engineUrl = $this->engineUrl();
        $url       = $engineUrl . '/synthesize';

        try {
            $this->ensureProfiles($request, $engineUrl);

            $pending = Http::timeout(120)
                ->withHeaders($this->engineHeaders())
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

            $resp = $pending->post($url);

            $contentType = $resp->header('Content-Type') ?? 'audio/wav';
            return response($resp->body(), $resp->status())
                ->header('Content-Type', $contentType);
        } catch (\Throwable $e) {
            return response()->json(['detail' => 'Engine proxy error: ' . $e->getMessage()], 502);
        }
    }
}
