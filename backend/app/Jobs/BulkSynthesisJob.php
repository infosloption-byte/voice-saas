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

    /** Number of waveform bars to extract. */
    private const WAVEFORM_BARS = 60;

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

        // --- Post-process audio server-side (enhance + trim + convert) ---
        [$processedData, $ext, $duration, $peaks] = $this->postProcessAudio($audioData);

        // --- Persist ---
        // Clean up any old audio file for this script.
        if ($script->audio_url) {
            Storage::disk('audio')->delete($script->audio_url);
        }

        $filename = $this->userId . '/script_' . $script->id . '.' . $ext;
        Storage::disk('audio')->put($filename, $processedData);

        $script->update([
            'has_audio'     => true,
            'audio_url'     => $filename,
            'duration'      => $duration,
            'waveform_peaks' => $peaks,
        ]);
    }

    // ── Audio post-processing ────────────────────────────────────────────

    /**
     * Apply server-side audio enhancement via FFmpeg:
     *   • High-pass filter at 80 Hz (removes rumble)
     *   • Loudness normalisation (EBU R128, -16 LUFS)
     *   • Silence trim from both ends
     *   • Encode to MP3 (smaller files, browser-native)
     *
     * Also extracts waveform peaks (WAVEFORM_BARS bars) and duration from
     * the processed audio.
     *
     * Falls back to raw WAV when FFmpeg is unavailable, extracting peaks
     * from the PCM data directly.
     *
     * @return array{0: string, 1: string, 2: float|null, 3: float[]|null}
     *         [audioBytes, extension, duration, peaks]
     */
    private function postProcessAudio(string $wavData): array
    {
        $tmpIn  = tempnam(sys_get_temp_dir(), 'vox_in_') . '.wav';
        $tmpOut = tempnam(sys_get_temp_dir(), 'vox_out_') . '.mp3';

        try {
            file_put_contents($tmpIn, $wavData);

            $cmd = [
                'ffmpeg', '-y', '-i', $tmpIn,
                '-af',
                'highpass=f=80,' .
                'loudnorm=I=-16:LRA=11:TP=-1.5,' .
                'silenceremove=start_periods=1:start_silence=0.04:start_threshold=-50dB' .
                ':stop_periods=1:stop_silence=0.4:stop_threshold=-50dB',
                '-codec:a', 'libmp3lame', '-q:a', '4',
                $tmpOut,
            ];

            $proc = proc_open(
                $cmd,
                [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
                $pipes
            );

            if (! is_resource($proc)) {
                throw new \RuntimeException('proc_open failed');
            }

            $stderr = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            $exitCode = proc_close($proc);

            if ($exitCode !== 0 || ! file_exists($tmpOut) || filesize($tmpOut) === 0) {
                Log::warning("BulkSynthesisJob: ffmpeg exited {$exitCode}: {$stderr}");
                throw new \RuntimeException("FFmpeg exited with code {$exitCode}");
            }

            $mp3Data  = file_get_contents($tmpOut);
            $duration = $this->probeDuration($tmpOut);
            $peaks    = $this->extractPeaksFromWav($wavData);

            return [$mp3Data, 'mp3', $duration, $peaks];
        } catch (\Throwable $e) {
            Log::info("BulkSynthesisJob: ffmpeg unavailable, storing raw WAV — {$e->getMessage()}");

            // Fallback: store raw WAV, compute duration + peaks from PCM.
            $duration = $this->estimateDuration($wavData);
            $peaks    = $this->extractPeaksFromWav($wavData);

            return [$wavData, 'wav', $duration, $peaks];
        } finally {
            if (file_exists($tmpIn))  @unlink($tmpIn);
            if (file_exists($tmpOut)) @unlink($tmpOut);
        }
    }

    /**
     * Use ffprobe to get the precise duration of a file in seconds.
     */
    private function probeDuration(string $filePath): ?float
    {
        try {
            $cmd = [
                'ffprobe', '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                $filePath,
            ];
            $proc = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
            if (! is_resource($proc)) return null;
            $out = trim(stream_get_contents($pipes[1]));
            fclose($pipes[1]);
            fclose($pipes[2]);
            proc_close($proc);
            return is_numeric($out) ? round((float) $out, 2) : null;
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Extract WAVEFORM_BARS normalised peak amplitudes from PCM WAV data.
     * Reads 16-bit signed little-endian samples from the data chunk.
     * Returns null if the WAV header is unreadable.
     *
     * @return float[]|null
     */
    private function extractPeaksFromWav(string $wavData): ?array
    {
        // Minimum WAV header size is 44 bytes.
        if (strlen($wavData) < 44) {
            return null;
        }

        // Parse header fields we need.
        $numChannels = unpack('v', substr($wavData, 22, 2))[1] ?? 1;
        $bitsPerSample = unpack('v', substr($wavData, 34, 2))[1] ?? 16;

        if ($bitsPerSample !== 16 || $numChannels < 1) {
            return null;
        }

        $bytesPerSample = 2; // 16-bit
        $dataOffset     = 44; // standard PCM WAV
        $dataBytes      = strlen($wavData) - $dataOffset;

        if ($dataBytes <= 0) {
            return null;
        }

        $totalSamples = intdiv($dataBytes, $bytesPerSample * $numChannels);
        $blockSize    = max(1, intdiv($totalSamples, self::WAVEFORM_BARS));

        $peaks  = [];
        $maxPeak = 0.0;

        for ($bar = 0; $bar < self::WAVEFORM_BARS; $bar++) {
            $start     = $dataOffset + $bar * $blockSize * $bytesPerSample * $numChannels;
            $end       = min($start + $blockSize * $bytesPerSample * $numChannels, strlen($wavData));
            $peak      = 0.0;

            for ($pos = $start; $pos < $end; $pos += $bytesPerSample) {
                if ($pos + 1 >= strlen($wavData)) break;
                $sample = unpack('s', substr($wavData, $pos, 2))[1]; // signed 16-bit LE
                $abs    = abs($sample) / 32768.0;
                if ($abs > $peak) $peak = $abs;
            }

            $peaks[]  = $peak;
            if ($peak > $maxPeak) $maxPeak = $peak;
        }

        // Normalise so the loudest bar = 1.0.
        if ($maxPeak > 0.0) {
            $peaks = array_map(fn($p) => round($p / $maxPeak, 4), $peaks);
        }

        return $peaks;
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
