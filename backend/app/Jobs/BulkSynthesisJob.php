<?php

namespace App\Jobs;

use App\Models\ActivityLog;
use App\Models\Script;
use App\Services\EngineResolver;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class BulkSynthesisJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 3600;
    public int $tries   = 1;

    /** Maximum seconds to wait for a single script's synthesis. */
    private const PER_SCRIPT_TIMEOUT = 300;

    /** Polling interval in seconds. */
    private const POLL_INTERVAL = 2;

    public function __construct(
        public readonly int    $userId,
        public readonly string $projectId,
        public readonly array  $scriptIds,
        public readonly string $engine,
        public readonly int    $activityLogId,
    ) {}

    public function handle(): void
    {
        $log = ActivityLog::find($this->activityLogId);

        // Load and validate scripts — only allow scripts that belong to this
        // user's project so we never process another user's content.
        $scripts = Script::whereIn('id', $this->scriptIds)
            ->where('project_id', $this->projectId)
            ->get()
            ->keyBy('id');

        // Honour the original order supplied by the caller.
        $ordered = collect($this->scriptIds)
            ->map(fn ($id) => $scripts->get($id))
            ->filter();

        $total     = $ordered->count();
        $done      = 0;
        $failed    = 0;
        $engineUrl = rtrim(EngineResolver::activeUrl(), '/');

        $totalWords = $ordered->sum(fn($s) => str_word_count($s->content ?? ''));

        $this->updateLog($log, "Bulk synthesis running: 0/{$total} done", 'running',
            detail: "model:{$this->engine}|words:{$totalWords}|scripts:{$total}");

        foreach ($ordered as $script) {
            try {
                $this->synthesiseScript($script, $engineUrl);
                $done++;
            } catch (\Throwable $e) {
                $failed++;
                Log::warning("BulkSynthesisJob: script {$script->id} failed — {$e->getMessage()}");
            }

            $this->updateLog(
                $log,
                "Bulk synthesis running: {$done}/{$total} done" . ($failed ? ", {$failed} failed" : ''),
                'running',
            );
        }

        $summary = "Bulk synthesis complete: {$done}/{$total} succeeded" . ($failed ? ", {$failed} failed" : '');
        $status  = ($failed === $total) ? 'failed' : 'done';
        $this->updateLog($log, $summary, $status, now());
    }

    // ── Per-script synthesis ────────────────────────────────────────────

    private function synthesiseScript(Script $script, string $engineUrl): void
    {
        $profileId  = $script->profile_id ?? '';
        $speakerMap = $script->speaker_map;

        // Ensure voice profile is present on the engine.
        if ($profileId) {
            try {
                \App\Services\VoiceProfileStore::ensureOnEngine($engineUrl, $profileId);
            } catch (\Throwable) {
                // Non-fatal: the engine will return an error we will surface.
            }
        }

        // --- Submit ---
        $pending = Http::withHeaders($this->engineHeaders())
            ->retry(2, 500, throw: false)
            ->asMultipart()
            ->attach('text',       $script->content ?? '')
            ->attach('tts_engine', $this->engine);

        if ($profileId) {
            $pending = $pending->attach('profile_id', $profileId);
        }

        if ($speakerMap) {
            $pending = $pending->attach(
                'speaker_map',
                is_array($speakerMap) ? json_encode($speakerMap) : (string) $speakerMap,
            );
        }

        if ($script->language) {
            $pending = $pending->attach('language', $script->language);
        }

        if ($script->speed) {
            $pending = $pending->attach('speed', (string) $script->speed);
        }

        $submitResp = $pending->timeout(30)->post($engineUrl . '/synthesize/submit');

        if (! $submitResp->successful()) {
            throw new \RuntimeException("Submit failed ({$submitResp->status()}): {$submitResp->body()}");
        }

        $jobId = $submitResp->json('job_id');
        if (! is_string($jobId) || $jobId === '') {
            throw new \RuntimeException('Engine did not return a job_id.');
        }

        // --- Poll status ---
        $deadline = time() + self::PER_SCRIPT_TIMEOUT;
        $status   = 'pending';

        while (time() < $deadline) {
            sleep(self::POLL_INTERVAL);

            $statusResp = Http::withHeaders($this->engineHeaders())
                ->timeout(10)
                ->retry(2, 300, throw: false)
                ->get($engineUrl . '/synthesize/status/' . $jobId);

            if (! $statusResp->successful()) {
                continue;
            }

            $status = $statusResp->json('status') ?? 'pending';

            if ($status === 'done') {
                break;
            }

            if ($status === 'failed' || $status === 'error') {
                $detail = $statusResp->json('detail') ?? $statusResp->body();
                throw new \RuntimeException("Engine job failed: {$detail}");
            }
        }

        if ($status !== 'done') {
            throw new \RuntimeException(
                "Timed out waiting for job {$jobId} after " . self::PER_SCRIPT_TIMEOUT . 's'
            );
        }

        // --- Fetch result ---
        $resultResp = Http::withHeaders($this->engineHeaders())
            ->timeout(120)
            ->withOptions(['stream' => true])
            ->get($engineUrl . '/synthesize/result/' . $jobId);

        if (! $resultResp->successful()) {
            throw new \RuntimeException("Result fetch failed ({$resultResp->status()})");
        }

        $audioData = $resultResp->body();
        if (empty($audioData)) {
            throw new \RuntimeException('Engine returned empty audio body.');
        }

        // --- Persist ---
        $filename = "script_{$script->id}.wav";
        Storage::disk('audio')->put($filename, $audioData);

        $duration = $this->estimateDuration($audioData);

        $script->update([
            'has_audio' => true,
            'audio_url' => $filename,
            'duration'  => $duration,
        ]);
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    private function engineHeaders(): array
    {
        $key = config('services.ai_engine.key', '');
        return $key ? ['X-Engine-Key' => $key] : [];
    }

    /**
     * Estimate audio duration from WAV byte count.
     * PCM WAV: byte_rate = sample_rate * channels * (bit_depth / 8).
     * Falls back to 22050 Hz / mono / 16-bit if the header is unreadable.
     */
    private function estimateDuration(string $audioData): ?float
    {
        if (strlen($audioData) >= 44) {
            $byteRate = unpack('V', substr($audioData, 28, 4))[1] ?? 0;
            $dataSize = strlen($audioData) - 44;
            if ($byteRate > 0 && $dataSize > 0) {
                return round($dataSize / $byteRate, 2);
            }
        }

        // Rough fallback: 22050 Hz, mono, 16-bit.
        $dataBytes = max(0, strlen($audioData) - 44);
        $byteRate  = 22050 * 1 * 2;
        return $byteRate > 0 ? round($dataBytes / $byteRate, 2) : null;
    }

    private function updateLog(
        ?ActivityLog $log,
        string $message,
        string $status,
        ?\Carbon\Carbon $endedAt = null,
        ?string $detail = null,
    ): void {
        if (! $log) {
            return;
        }

        $data = ['message' => $message, 'status' => $status];
        if ($endedAt) $data['ended_at'] = $endedAt;
        if ($detail !== null) $data['detail'] = $detail;

        $log->update($data);
    }

    public function failed(\Throwable $exception): void
    {
        $log = ActivityLog::find($this->activityLogId);
        $this->updateLog(
            $log,
            'Bulk synthesis failed: ' . $exception->getMessage(),
            'failed',
            now(),
        );
    }
}
