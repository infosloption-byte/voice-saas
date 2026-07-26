<?php

namespace App\Jobs;

use App\Models\ActivityLog;
use App\Models\Script;
use App\Models\VoiceProfile;
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

    /**
     * Tone presets — kept in sync with the frontend TONE_PRESETS
     * (frontend/src/constants.tsx). These map a tone name to the engine
     * tuning knobs so server-side synthesis sounds identical to the old
     * browser path.
     */
    private const TONE_PRESETS = [
        'natural'      => ['temperature' => 0.65, 'top_k' => 50, 'top_p' => 0.85, 'cfg_strength' => 2.0, 'f5_rms' => 0.10, 'f5_sway' => -1.0, 'f5_pace' => 1.00],
        'expressive'   => ['temperature' => 0.85, 'top_k' => 80, 'top_p' => 0.95, 'cfg_strength' => 2.6, 'f5_rms' => 0.12, 'f5_sway' => -0.6, 'f5_pace' => 1.03],
        'calm'         => ['temperature' => 0.40, 'top_k' => 30, 'top_p' => 0.70, 'cfg_strength' => 1.6, 'f5_rms' => 0.07, 'f5_sway' => -1.2, 'f5_pace' => 0.92],
        'energetic'    => ['temperature' => 0.90, 'top_k' => 90, 'top_p' => 0.98, 'cfg_strength' => 2.8, 'f5_rms' => 0.14, 'f5_sway' => -0.5, 'f5_pace' => 1.12],
        'cheerful'     => ['temperature' => 0.80, 'top_k' => 70, 'top_p' => 0.92, 'cfg_strength' => 2.4, 'f5_rms' => 0.12, 'f5_sway' => -0.7, 'f5_pace' => 1.05],
        'serious'      => ['temperature' => 0.45, 'top_k' => 35, 'top_p' => 0.75, 'cfg_strength' => 2.2, 'f5_rms' => 0.10, 'f5_sway' => -1.2, 'f5_pace' => 0.96],
        'dramatic'     => ['temperature' => 0.95, 'top_k' => 95, 'top_p' => 0.99, 'cfg_strength' => 3.0, 'f5_rms' => 0.13, 'f5_sway' => -0.4, 'f5_pace' => 0.98],
        'whisper'      => ['temperature' => 0.30, 'top_k' => 20, 'top_p' => 0.60, 'cfg_strength' => 1.4, 'f5_rms' => 0.05, 'f5_sway' => -1.3, 'f5_pace' => 0.90],
        'storytelling' => ['temperature' => 0.72, 'top_k' => 60, 'top_p' => 0.88, 'cfg_strength' => 2.1, 'f5_rms' => 0.10, 'f5_sway' => -0.9, 'f5_pace' => 1.00],
    ];

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
        $lastError = '';
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
                $lastError = $e->getMessage();
                Log::warning("BulkSynthesisJob: script {$script->id} failed — {$e->getMessage()}");
            }

            $this->updateLog(
                $log,
                "Bulk synthesis running: {$done}/{$total} done" . ($failed ? ", {$failed} failed" : ''),
                'running',
            );
        }

        $summary = "Bulk synthesis complete: {$done}/{$total} succeeded" . ($failed ? ", {$failed} failed" : '');
        // When everything failed, surface the underlying reason so the user
        // isn't left with a bare "3 failed" in the activity log.
        if ($failed === $total && $lastError !== '') {
            $summary .= ' — ' . $this->truncate($lastError, 180);
        }
        $status  = ($failed === $total) ? 'failed' : 'done';
        $this->updateLog($log, $summary, $status, now());
    }

    // ── Per-script synthesis ────────────────────────────────────────────

    private function synthesiseScript(Script $script, string $engineUrl): void
    {
        // The engine identifies voices by their engine_key (a UUID), not by the
        // user-facing profile_id stored on the script. Resolve it here, exactly
        // as the browser path does, or every real recorded voice fails.
        $engineKey = $this->resolveEngineKey($script->profile_id ?? '');

        // Resolve any multi-voice speaker_map entries from profile_id → engine_key.
        $speakerMap = $this->resolveSpeakerMap($script->speaker_map);

        // Tone → engine tuning knobs (kept in sync with the frontend).
        $tone   = $script->tone ?: 'natural';
        $preset = self::TONE_PRESETS[$tone] ?? self::TONE_PRESETS['natural'];

        // advanced_params override the preset's XTTS knobs when the user has
        // manually tuned them.
        $adv = $script->advanced_params ?? [];
        if (is_string($adv)) {
            $adv = json_decode($adv, true) ?: [];
        }
        $temperature = $adv['temperature'] ?? $preset['temperature'];
        $topK        = $adv['top_k']       ?? $preset['top_k'];
        $topP        = $adv['top_p']       ?? $preset['top_p'];

        // Speed: clamp 0.5–2.0; F5 folds the tone's pace into the user's speed.
        $userSpeed = max(0.5, min(2.0, (float) ($script->speed ?: 1.0)));
        $f5Speed   = max(0.5, min(2.0, $userSpeed * ($preset['f5_pace'] ?? 1.0)));
        $speed     = $this->engine === 'f5' ? $f5Speed : $userSpeed;

        // Ensure the voice profile (and any speaker-map voices) are present on
        // the engine, provisioning from shared storage if needed.
        foreach ($this->collectEngineKeys($engineKey, $speakerMap) as $key) {
            try {
                \App\Services\VoiceProfileStore::ensureOnEngine($engineUrl, $key);
            } catch (\Throwable) {
                // Non-fatal: the engine will return an error we will surface.
            }
        }

        // Build the shared engine params for every chunk submission.
        $baseParams = [
            'tts_engine'          => $this->engine,
            'speed'               => (string) $speed,
            'temperature'         => (string) $temperature,
            'top_k'               => (string) $topK,
            'top_p'               => (string) $topP,
            'gap_ms'              => '60',
            'cfg_strength'        => (string) ($preset['cfg_strength'] ?? 2.0),
            'target_rms'          => (string) ($preset['f5_rms'] ?? 0.1),
            'sway_sampling_coef'  => (string) ($preset['f5_sway'] ?? -1.0),
        ];
        if ($this->engine === 'xtts') {
            $baseParams['repetition_penalty'] = '5.0';
        }
        if ($engineKey) {
            $baseParams['profile_id'] = $engineKey;
        }
        if ($speakerMap) {
            $baseParams['speaker_map'] = json_encode($speakerMap);
        }
        if ($script->language) {
            $baseParams['language'] = $script->language;
        }

        // --- Chunk long texts so F5-TTS / XTTS don't truncate or fail ---
        // Multi-voice scripts are not chunked (speaker-tagged text must be
        // processed whole so the engine can switch speakers mid-script).
        $content    = $script->content ?? '';
        $isMulti    = ! empty($speakerMap);
        $chunks     = ($isMulti || str_word_count($content) <= 150)
            ? [$content]
            : $this->splitIntoChunks($content);

        $chunkWavs = [];
        foreach ($chunks as $chunkText) {
            $chunkWavs[] = $this->submitAndFetch($engineUrl, $chunkText, $baseParams);
        }

        // Concatenate WAV chunks (raw PCM splice — header from first, data from all).
        $audioData = count($chunkWavs) === 1
            ? $chunkWavs[0]
            : $this->concatWavs($chunkWavs);

        if (empty($audioData)) {
            throw new \RuntimeException('Engine returned empty audio body.');
        }

        // --- Post-process audio server-side (enhance + trim + convert) ---
        [$processedData, $ext, $duration, $peaks] = $this->postProcessAudio($audioData);

        // --- Persist ---
        if ($script->audio_url) {
            $deleted = Storage::disk('audio')->delete($script->audio_url);
            if (!$deleted) {
                Log::warning("BulkSynthesisJob: failed to delete old audio for script {$script->id} at '{$script->audio_url}' (non-fatal, continuing).");
            }
        }

        $filename = $this->userId . '/script_' . $script->id . '.' . $ext;

        // IMPORTANT: the 'audio' disk has 'throw' => false, so put() returning
        // false on a failed S3 write (bad credentials, wrong bucket/region,
        // permission denied, network error) was previously silently ignored —
        // the code went straight on to mark has_audio=true regardless of
        // whether anything was actually stored. That is the single most
        // likely explanation for "DB says has_audio=true / dashboard shows
        // green, but the file can't be served back": the write never
        // actually succeeded (or wrote to a location the read path can't
        // reach) and nothing said so.
        $putOk = Storage::disk('audio')->put($filename, $processedData);
        if (!$putOk) {
            Log::error(
                "BulkSynthesisJob: Storage::put() returned false for script {$script->id}, " .
                "disk=" . config('filesystems.disks.audio.driver') . ", key='{$filename}', " .
                'bytes=' . strlen($processedData) . '. Refusing to mark has_audio=true.'
            );
            throw new \RuntimeException("Failed to store audio file to disk (put() returned false) for script {$script->id}.");
        }

        // Read-back verification: don't trust put()'s return value alone.
        // If exists() can't see what we just wrote (e.g. write succeeded to
        // one path/region but reads are scoped elsewhere, or eventual-
        // consistency edge cases), fail loudly now instead of leaving a
        // has_audio=true record that will 404 the first time anyone tries
        // to actually play it back.
        $verified = Storage::disk('audio')->exists($filename);
        if (!$verified) {
            Log::error(
                "BulkSynthesisJob: post-write verification failed for script {$script->id} — " .
                "put() reported success but exists('{$filename}') on disk=" .
                config('filesystems.disks.audio.driver') . ' returned false immediately after. ' .
                'This points at an IAM/bucket-policy asymmetry (write allowed, read/head denied) ' .
                'or a region/bucket mismatch between write and read paths. Refusing to mark has_audio=true.'
            );
            throw new \RuntimeException("Audio file for script {$script->id} could not be verified after writing (exists() check failed).");
        }

        Log::info("BulkSynthesisJob: verified audio stored for script {$script->id} at '{$filename}' (disk=" . config('filesystems.disks.audio.driver') . ').');

        $script->update([
            'has_audio'      => true,
            'audio_url'      => $filename,
            'duration'       => $duration,
            'waveform_peaks' => $peaks,
        ]);
    }

    // ── Chunking + WAV concat ────────────────────────────────────────────

    /**
     * Split text into sentence-aligned chunks of at most $maxWords words.
     * Mirrors the browser's splitIntoChunks() in WorkspacePage.tsx.
     *
     * @return string[]
     */
    private function splitIntoChunks(string $text, int $maxWords = 150): array
    {
        // Split on sentence-ending punctuation, keeping the delimiter.
        $sentences = preg_split('/(?<=[.!?])\s+/', trim($text), -1, PREG_SPLIT_NO_EMPTY);
        if (! $sentences) {
            return [$text];
        }

        $chunks  = [];
        $current = '';

        foreach ($sentences as $sentence) {
            $candidate = $current === '' ? $sentence : $current . ' ' . $sentence;
            if (str_word_count($candidate) > $maxWords && $current !== '') {
                $chunks[]  = $current;
                $current   = $sentence;
            } else {
                $current   = $candidate;
            }
        }

        if ($current !== '') {
            $chunks[] = $current;
        }

        return array_values(array_filter($chunks));
    }

    /**
     * Submit one text chunk to the engine, poll until done, and return the
     * raw WAV bytes. Throws on any failure.
     */
    private function submitAndFetch(string $engineUrl, string $text, array $params): string
    {
        $pending = Http::withHeaders($this->engineHeaders())
            ->retry(2, 500, throw: false)
            ->asMultipart()
            ->attach('text', $text);

        foreach ($params as $name => $value) {
            $pending = $pending->attach($name, $value);
        }

        $submitResp = $pending->timeout(30)->post($engineUrl . '/synthesize/submit');

        if (! $submitResp->successful()) {
            throw new \RuntimeException("Submit failed ({$submitResp->status()}): {$submitResp->body()}");
        }

        $jobId = $submitResp->json('job_id');
        if (! is_string($jobId) || $jobId === '') {
            throw new \RuntimeException('Engine did not return a job_id.');
        }

        // Poll status.
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

        $resultResp = Http::withHeaders($this->engineHeaders())
            ->timeout(120)
            ->withOptions(['stream' => true])
            ->get($engineUrl . '/synthesize/result/' . $jobId);

        if (! $resultResp->successful()) {
            throw new \RuntimeException("Result fetch failed ({$resultResp->status()})");
        }

        $data = $resultResp->body();
        if (empty($data)) {
            throw new \RuntimeException('Engine returned empty audio body.');
        }

        return $data;
    }

    /**
     * Splice multiple PCM WAV blobs into one.
     * Keeps the 44-byte header from the first file and appends the raw PCM
     * data from every file (skipping each file's own 44-byte header).
     * Updates the RIFF and data chunk sizes in the combined header.
     *
     * @param string[] $wavs
     */
    private function concatWavs(array $wavs): string
    {
        $header   = substr($wavs[0], 0, 44);
        $allPcm   = '';

        foreach ($wavs as $wav) {
            if (strlen($wav) > 44) {
                $allPcm .= substr($wav, 44);
            }
        }

        $dataSize = strlen($allPcm);
        $riffSize = 36 + $dataSize;

        // Patch RIFF chunk size at offset 4 (little-endian uint32)
        $header = substr_replace($header, pack('V', $riffSize), 4, 4);
        // Patch data chunk size at offset 40 (little-endian uint32)
        $header = substr_replace($header, pack('V', $dataSize), 40, 4);

        return $header . $allPcm;
    }

    // ── Voice-profile resolution ─────────────────────────────────────────

    /**
     * Resolve a script's stored profile_id to the engine_key the engine
     * actually uses. Built-in voices ("builtin:Name") are passed through
     * unchanged, as are ids that already match an engine_key.
     */
    private function resolveEngineKey(string $profileId): string
    {
        if ($profileId === '' || str_starts_with($profileId, 'builtin:')) {
            return $profileId;
        }

        $profile = VoiceProfile::where('user_id', $this->userId)
            ->where('profile_id', $profileId)
            ->first();

        return $profile?->engine_key ?: $profileId;
    }

    /**
     * Resolve a multi-voice speaker_map's values (profile_ids) to engine_keys.
     * Accepts an array or JSON string; returns an array (or null when empty).
     */
    private function resolveSpeakerMap($speakerMap): ?array
    {
        if (! $speakerMap) {
            return null;
        }

        $map = is_string($speakerMap) ? json_decode($speakerMap, true) : $speakerMap;
        if (! is_array($map) || empty($map)) {
            return null;
        }

        $resolved = [];
        foreach ($map as $speaker => $profileId) {
            $resolved[$speaker] = is_string($profileId)
                ? $this->resolveEngineKey($profileId)
                : $profileId;
        }

        return $resolved;
    }

    /**
     * Gather the distinct engine_keys that must exist on the engine for this
     * synthesis: the primary voice plus any speaker-map voices. Built-in
     * voices are skipped (the engine ships with them).
     *
     * @return string[]
     */
    private function collectEngineKeys(string $primaryKey, ?array $speakerMap): array
    {
        $keys = [];
        if ($primaryKey !== '' && ! str_starts_with($primaryKey, 'builtin:')) {
            $keys[] = $primaryKey;
        }
        foreach ($speakerMap ?? [] as $key) {
            if (is_string($key) && $key !== '' && ! str_starts_with($key, 'builtin:')) {
                $keys[] = $key;
            }
        }

        return array_values(array_unique($keys));
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

            // Filter chain:
            //   highpass  — remove sub-80Hz rumble
            //   loudnorm  — EBU R128 loudness normalisation
            //   silenceremove (+areverse) — trim leading AND trailing silence
            //
            // IMPORTANT: a single silenceremove with stop_periods=1 truncates
            // the audio at the first *internal* pause longer than stop_silence
            // (e.g. the gap between two sentences), losing everything after it.
            // The safe idiom is: trim leading silence, reverse, trim leading
            // (= original trailing) silence, reverse back — which never touches
            // pauses in the middle of speech.
            $trim = 'silenceremove=start_periods=1:start_duration=0'
                  . ':start_silence=0.06:start_threshold=-50dB:detection=peak';

            $cmd = [
                'ffmpeg', '-y', '-i', $tmpIn,
                '-af',
                'highpass=f=80,'
                . 'loudnorm=I=-16:LRA=11:TP=-1.5,'
                . $trim . ',areverse,' . $trim . ',areverse',
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

    private function truncate(string $text, int $max): string
    {
        $text = trim(preg_replace('/\s+/', ' ', $text));
        return strlen($text) > $max ? substr($text, 0, $max - 1) . '…' : $text;
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
