<?php

namespace App\Jobs\Concerns;

use App\Models\ActivityLog;
use App\Models\DubbingJob;
use App\Models\VoiceProfile;
use Illuminate\Support\Facades\Http;

/**
 * Helpers shared by PrepareDubbingJob (extract/transcribe/translate) and
 * FinalizeDubbingJob (synthesize/splice/mux). Split out of what used to be
 * one ~650-line VideoDubbingJob (Aug 22, 2026 — see task #6 in
 * docs/ENHANCEMENT_TASKS.md for why the job itself was split into two
 * phases) so neither half has to duplicate this plumbing.
 */
trait DubbingPipelineHelpers
{
    /** Max seconds to wait for a single segment's synthesis. */
    private const PER_SEGMENT_TIMEOUT = 180;

    /** Polling interval in seconds (matches BulkSynthesisJob). */
    private const POLL_INTERVAL = 2;

    /**
     * Segments that overrun their original window by more than this ratio
     * are left at natural length instead of being atempo-stretched — beyond
     * ~15-20% speed change, stretched TTS audio starts sounding artificial.
     */
    private const MAX_STRETCH_RATIO = 1.20;

    /**
     * Segments that overrun by more than MAX_STRETCH_RATIO are left at
     * natural length and the overflow counted (never force-compressed).
     * This tighter ceiling is only for OPTIONAL drift recovery on segments
     * that already fit their own window with slack to spare: those get
     * squeezed a little further, up to this ratio, to help pay down debt
     * from an earlier overflowed segment. Kept stricter than
     * MAX_STRETCH_RATIO since this compression isn't needed for the
     * segment to fit — it's purely opportunistic, so it should stay
     * closer to inaudible.
     */
    private const RECOVERY_STRETCH_RATIO = 1.10;

    /**
     * Both TTS engines actually synthesize at 24000Hz natively (see
     * ai-engine/main.py: xtts_synthesize_with_latents's sf.write(...,
     * 24000, ...) and F5's sr = 24000). Matching that here avoids
     * needlessly downsampling every segment below its real output rate.
     */
    private const SAMPLE_RATE = 24000;

    // ── Pipeline steps ───────────────────────────────────────────────────

    private function transcribeSegments(string $engineUrl, string $audioPath): array
    {
        $resp = Http::withHeaders($this->engineHeaders())
            ->timeout(180)
            ->attach('file', file_get_contents($audioPath), 'audio.wav')
            ->post($engineUrl . '/transcribe/segments');

        if (! $resp->successful()) {
            throw new \RuntimeException("Transcription failed ({$resp->status()}): {$resp->body()}");
        }

        return $resp->json('segments') ?? [];
    }

    /**
     * Same call as transcribeSegments(), but also surfaces the response's
     * top-level `language` field (Whisper's own detected source language)
     * instead of discarding it. Added for ExtractAudioAssetJob (task #15
     * Phase 4), which — unlike PrepareDubbingJob — has somewhere to
     * actually persist it (VideoProjectAsset::detected_language). Kept as
     * a separate method rather than changing transcribeSegments()'s
     * return shape, so PrepareDubbingJob's existing `$this->
     * transcribeSegments($engineUrl, $audioPath)` call (which expects a
     * plain segments array) doesn't have to change.
     *
     * @return array{segments: array, language: ?string}
     */
    private function transcribeSegmentsWithLanguage(string $engineUrl, string $audioPath): array
    {
        $resp = Http::withHeaders($this->engineHeaders())
            ->timeout(180)
            ->attach('file', file_get_contents($audioPath), 'audio.wav')
            ->post($engineUrl . '/transcribe/segments');

        if (! $resp->successful()) {
            throw new \RuntimeException("Transcription failed ({$resp->status()}): {$resp->body()}");
        }

        return [
            'segments' => $resp->json('segments') ?? [],
            'language' => $resp->json('language'),
        ];
    }

    private function translateSegment(
        string $engineUrl, string $text, string $sourceLang, string $targetLang,
        string $contextBefore = '', string $contextAfter = ''
    ): string {
        if (trim($text) === '') {
            return '';
        }

        $headers = $this->engineHeaders();
        if ($gemini = \App\Services\Settings::get('gemini_api_key')) {
            $headers['X-Gemini-Key'] = $gemini;
        }

        $resp = Http::withHeaders($headers)
            ->timeout(60)
            ->retry(2, 300, throw: false)
            ->post($engineUrl . '/translate', [
                'text'           => $text,
                'source_lang'    => $sourceLang,
                'target_lang'    => $targetLang,
                'context_before' => $contextBefore,
                'context_after'  => $contextAfter,
            ]);

        if (! $resp->successful()) {
            throw new \RuntimeException("Segment translation failed ({$resp->status()}): {$resp->body()}");
        }

        return $resp->json('translated_text') ?? $text;
    }

    /** Submit + poll + fetch one segment's synthesis. Mirrors BulkSynthesisJob::submitAndFetch. */
    private function synthesizeSegment(string $engineUrl, string $text, string $engineKey, string $language, string $ttsEngine): string
    {
        $pending = Http::withHeaders($this->engineHeaders())
            ->retry(2, 500, throw: false)
            ->asMultipart()
            ->attach('text', $text)
            ->attach('language', $language)
            ->attach('tts_engine', $ttsEngine);

        if ($engineKey) {
            $pending = $pending->attach('profile_id', $engineKey);
        }

        $submitResp = $pending->timeout(30)->post($engineUrl . '/synthesize/submit');
        if (! $submitResp->successful()) {
            throw new \RuntimeException("Segment submit failed ({$submitResp->status()}): {$submitResp->body()}");
        }

        $jobId = $submitResp->json('job_id');
        if (! is_string($jobId) || $jobId === '') {
            throw new \RuntimeException('Engine did not return a job_id for segment synthesis.');
        }

        $deadline = time() + self::PER_SEGMENT_TIMEOUT;
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
                throw new \RuntimeException("Segment synthesis job failed: {$detail}");
            }
        }

        if ($status !== 'done') {
            throw new \RuntimeException("Timed out waiting for segment job {$jobId} after " . self::PER_SEGMENT_TIMEOUT . 's');
        }

        $resultResp = Http::withHeaders($this->engineHeaders())
            ->timeout(60)
            ->get($engineUrl . '/synthesize/result/' . $jobId);

        if (! $resultResp->successful()) {
            throw new \RuntimeException("Segment result fetch failed ({$resultResp->status()})");
        }

        $data = $resultResp->body();
        if (empty($data)) {
            throw new \RuntimeException('Engine returned empty audio for segment.');
        }

        return $data;
    }

    // ── Audio helpers ────────────────────────────────────────────────────

    /** Silence WAV of the given duration, same format as engine output (mono/16-bit/24000Hz). */
    private function generateSilenceWav(float $seconds): string
    {
        $seconds = max(0.0, $seconds);
        $tmp = tempnam(sys_get_temp_dir(), 'dub_sil_') . '.wav';
        $this->runFfmpeg([
            'ffmpeg', '-y',
            '-f', 'lavfi', '-i', 'anullsrc=r=' . self::SAMPLE_RATE . ':cl=mono',
            '-t', (string) $seconds,
            '-acodec', 'pcm_s16le', $tmp,
        ], 'Silence padding');
        $data = file_get_contents($tmp);
        @unlink($tmp);
        return $data ?: '';
    }

    /**
     * Splice multiple PCM WAV blobs into one continuous track.
     * Same raw-header-plus-concatenated-PCM technique as
     * BulkSynthesisJob::concatWavs, generalized for a mixed list of
     * synthesized-segment and silence-padding WAVs.
     *
     * @param string[] $wavs
     */
    private function spliceWavs(array $wavs): string
    {
        $wavs = array_values(array_filter($wavs, fn($w) => strlen($w) > 44));
        if (empty($wavs)) {
            throw new \RuntimeException('No audio segments to splice — dubbing produced no output.');
        }

        $header = substr($wavs[0], 0, 44);
        $allPcm = '';
        foreach ($wavs as $wav) {
            $allPcm .= substr($wav, 44);
        }

        $dataSize = strlen($allPcm);
        $riffSize = 36 + $dataSize;

        $header = substr_replace($header, pack('V', $riffSize), 4, 4);
        $header = substr_replace($header, pack('V', $dataSize), 40, 4);

        return $header . $allPcm;
    }

    private function estimateWavDuration(string $wavData): float
    {
        if (strlen($wavData) >= 44) {
            $byteRate = unpack('V', substr($wavData, 28, 4))[1] ?? 0;
            $dataSize = strlen($wavData) - 44;
            if ($byteRate > 0 && $dataSize > 0) {
                return round($dataSize / $byteRate, 3);
            }
        }
        $byteRate = self::SAMPLE_RATE * 2; // mono, 16-bit
        $dataBytes = max(0, strlen($wavData) - 44);
        return $byteRate > 0 ? round($dataBytes / $byteRate, 3) : 0.0;
    }

    private function probeDuration(string $path): ?float
    {
        $proc = proc_open(
            ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', $path],
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes
        );
        if (! is_resource($proc)) {
            return null;
        }
        $out = stream_get_contents($pipes[1]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($proc);

        $val = trim($out);
        return is_numeric($val) ? round((float) $val, 3) : null;
    }

    private function runFfmpeg(array $cmd, string $context, int $timeoutSeconds = 480): void
    {
        $proc = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (! is_resource($proc)) {
            throw new \RuntimeException("{$context}: could not start ffmpeg process.");
        }

        // A hung ffmpeg call used to just sit there for as long as the
        // WHOLE JOB's timeout allowed before anything noticed it — this is
        // exactly what "still running" on a single mux/atempo step for
        // 30+ minutes looked like in production before this fix. No single
        // ffmpeg invocation in this pipeline legitimately needs more than a
        // few minutes (the final mux uses -c:v copy, so even that's a
        // remux, not a re-encode), so a hang this long can only mean it's
        // genuinely stuck — kill it and fail fast with a clear reason
        // instead of silently occupying the queue slot indefinitely.
        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);

        $stdout   = '';
        $stderr   = '';
        $deadline = microtime(true) + $timeoutSeconds;
        $killed   = false;

        while (true) {
            $status = proc_get_status($proc);

            // Drain both pipes every iteration, whether or not the process
            // has exited yet — the OS pipe buffer is finite, and a process
            // still flushing its last output when we notice it's done
            // would otherwise lose those final bytes (including the fatal
            // error tailOutput() below exists to surface).
            $stdout .= (string) stream_get_contents($pipes[1]);
            $stderr .= (string) stream_get_contents($pipes[2]);

            if (! $status['running']) {
                break;
            }

            if (microtime(true) > $deadline) {
                proc_terminate($proc, 15); // SIGTERM — ask nicely first
                usleep(500_000);
                if (proc_get_status($proc)['running']) {
                    proc_terminate($proc, 9); // SIGKILL — it didn't listen
                }
                $killed = true;
                break;
            }

            usleep(100_000);
        }

        fclose($pipes[1]);
        fclose($pipes[2]);
        $exitCode = proc_close($proc);

        if ($killed) {
            throw new \RuntimeException("{$context} timed out after {$timeoutSeconds}s and was killed — ffmpeg was hung, not just slow.");
        }

        if ($exitCode !== 0) {
            // ffmpeg ALWAYS prints its version/build-configuration banner
            // first on stderr, then any per-command output, then the actual
            // fatal error last, right before it exits. Truncating from the
            // start (as truncate() does) reliably keeps the useless banner
            // and throws away the one line that would actually explain the
            // failure, so this keeps the TAIL instead.
            throw new \RuntimeException("{$context} failed (ffmpeg exit {$exitCode}): " . $this->tailOutput($stderr, 500));
        }
    }

    // ── Misc helpers ─────────────────────────────────────────────────────

    private function resolveEngineKey(int $userId, string $profileId): string
    {
        if ($profileId === '' || str_starts_with($profileId, 'builtin:')) {
            return $profileId;
        }
        $profile = VoiceProfile::where('user_id', $userId)
            ->where('profile_id', $profileId)
            ->first();
        return $profile?->engine_key ?: $profileId;
    }

    private function engineHeaders(): array
    {
        $key = config('services.ai_engine.key', '');
        return $key ? ['X-Engine-Key' => $key] : [];
    }

    private function advance(DubbingJob $job, ?ActivityLog $log, string $status, int $progress, string $message): void
    {
        $job->update(['status' => $status, 'progress' => $progress]);
        $this->updateActivityLog($log, $message, 'running');
    }

    private function updateActivityLog(?ActivityLog $log, string $message, string $status, ?\Carbon\Carbon $endedAt = null): void
    {
        if (! $log) {
            return;
        }
        $data = ['message' => $message, 'status' => $status];
        if ($endedAt) {
            $data['ended_at'] = $endedAt;
        }
        $log->update($data);
    }

    private function truncate(string $text, int $max): string
    {
        $text = trim(preg_replace('/\s+/', ' ', $text));
        return strlen($text) > $max ? substr($text, 0, $max - 1) . '…' : $text;
    }

    /**
     * Same shape as truncate(), but keeps the END of the text instead of
     * the start — for ffmpeg's stderr specifically, where the version/
     * build banner is always first and the actual fatal error is always
     * last. See runFfmpeg().
     */
    private function tailOutput(string $text, int $max): string
    {
        $text = trim(preg_replace('/\s+/', ' ', $text));
        return strlen($text) > $max ? '…' . substr($text, -$max) : $text;
    }

    private function rrmdir(string $dir): void
    {
        if (! is_dir($dir)) {
            return;
        }
        foreach (scandir($dir) ?: [] as $f) {
            if ($f === '.' || $f === '..') continue;
            $path = "{$dir}/{$f}";
            is_dir($path) ? $this->rrmdir($path) : @unlink($path);
        }
        @rmdir($dir);
    }
}
