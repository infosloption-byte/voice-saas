<?php

namespace App\Http\Controllers;

use App\Services\EngineResolver;
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

    /** POST /api/engine/synthesize/submit  — forward multipart to the active engine */
    public function submit(Request $request)
    {
        $url = $this->engineUrl() . '/synthesize/submit';

        try {
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
        $url = $this->engineUrl() . '/synthesize';

        try {
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
