<?php

namespace App\Jobs;

use App\Models\ActivityLog;
use App\Models\DubbingJob;
use App\Models\VoiceProfile;
use App\Services\EngineResolver;
use App\Services\SynthesisQuota;
use App\Services\TranslationQuota;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Video dubbing MVP (task #6). Pipeline, mirroring BulkSynthesisJob's shape:
 *
 *   1. Extract audio from the uploaded video (ffmpeg).
 *   2. Transcribe with per-segment timestamps (ai-engine's new
 *      /transcribe/segments — see ai-engine/main.py).
 *   3. Translate each segment's text (ai-engine's existing /translate).
 *   4. Synthesize each translated segment in the user's cloned voice
 *      (ai-engine's existing /synthesize/submit + poll + result — same
 *      polling loop BulkSynthesisJob already uses for text chunks).
 *   5. Stretch/pad each segment to its original timing window and splice
 *      them into one continuous track (ffmpeg atempo + raw-PCM concat).
 *   6. Mux the dubbed track back onto the original video (ffmpeg, video
 *      stream copied untouched — no re-encoding).
 *
 * Chosen v1 timing behavior (agreed in the task #6 planning discussion):
 * segments that overrun their window by more than MAX_STRETCH_RATIO are
 * NOT force-compressed (that starts sounding artificial past ~15-20%
 * speed-up) — they're left at natural length and allowed to drift the
 * timeline for subsequent segments. segment_overflow_count on the
 * DubbingJob row exists specifically so this can be monitored in
 * production; if it climbs, that's the signal to build the "absorb into
 * next gap" refinement mentioned in planning, rather than guessing at it
 * up front.
 */
class VideoDubbingJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $timeout = 3600;
    public int $tries   = 1;

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

    private const SAMPLE_RATE = 22050;

    public function __construct(
        public readonly string $dubbingJobId,
    ) {}

    public function handle(): void
    {
        $job = DubbingJob::find($this->dubbingJobId);
        if (! $job) {
            Log::warning("VideoDubbingJob: job {$this->dubbingJobId} not found, skipping.");
            return;
        }

        $user = $job->user;
        $log  = $job->activity_log_id ? ActivityLog::find($job->activity_log_id) : null;

        $tmpDir = sys_get_temp_dir() . '/dub_' . $job->id;
        @mkdir($tmpDir, 0700, true);

        try {
            // Reserve quota up front — one dubbing job = 1 translation credit
            // + 1 synthesis credit, NOT one credit per segment. A video can
            // easily have 30-50 segments; metering per-segment against the
            // same monthly translation/synthesis limits used for single
            // scripts would exhaust a normal plan's quota on one video.
            // Translation quota is reserved now (checkAndRecord is atomic);
            // synthesis quota is only *recorded* after the whole pipeline
            // actually succeeds (checked here, recorded at the bottom), so a
            // failed job doesn't burn a synthesis credit for nothing.
            if ($user) {
                $translateBlock = TranslationQuota::checkAndRecord($user);
                if ($translateBlock !== null) {
                    throw new \RuntimeException($translateBlock['message'] ?? 'Translation quota exceeded.');
                }
                if (! SynthesisQuota::hasRemaining($user)) {
                    throw new \RuntimeException('Synthesis quota exceeded for this plan period.');
                }
            }

            $engineUrl = rtrim(EngineResolver::activeUrl(), '/');
            $engineKey = $this->resolveEngineKey($job->user_id, $job->voice_profile_id);

            $this->advance($job, $log, 'transcribing', 5, 'Extracting audio and transcribing…');

            // ── 1. Download source video, extract audio ──────────────────
            $videoPath = $tmpDir . '/source.mp4';
            $sourceStream = Storage::disk('video')->readStream($job->source_video_path);
            if (! $sourceStream) {
                throw new \RuntimeException('Could not read uploaded source video from storage.');
            }
            file_put_contents($videoPath, stream_get_contents($sourceStream));
            fclose($sourceStream);

            $audioPath = $tmpDir . '/audio.wav';
            $this->runFfmpeg([
                'ffmpeg', '-y', '-i', $videoPath,
                '-vn', '-ar', (string) self::SAMPLE_RATE, '-ac', '1',
                '-f', 'wav', '-acodec', 'pcm_s16le', $audioPath,
            ], 'Audio extraction');

            $videoDuration = $this->probeDuration($videoPath);

            // ── 2. Transcribe with segment timestamps ─────────────────────
            $segments = $this->transcribeSegments($engineUrl, $audioPath);
            if (empty($segments)) {
                throw new \RuntimeException('Transcription returned no speech segments.');
            }
            $job->update(['segment_count' => count($segments)]);

            // ── 3. Translate each segment ──────────────────────────────
            $this->advance($job, $log, 'translating', 25,
                'Translating ' . count($segments) . ' segments…');

            $sourceLang = $segments[0]['detected_language'] ?? ($job->source_language ?: 'en');
            $translated = [];
            foreach ($segments as $i => $seg) {
                $translated[] = [
                    'start' => $seg['start'],
                    'end'   => $seg['end'],
                    'text'  => $this->translateSegment($engineUrl, $seg['text'], $sourceLang, $job->target_language),
                ];
                if ($i % 5 === 0) {
                    $pct = 25 + (int) round(($i / max(1, count($segments))) * 20);
                    $job->update(['progress' => $pct]);
                }
            }

            // ── 4 & 5. Synthesize each segment, fit to its timing window ──
            $this->advance($job, $log, 'synthesizing', 45,
                'Synthesizing ' . count($translated) . ' segments in the cloned voice…');

            if ($engineKey) {
                try {
                    \App\Services\VoiceProfileStore::ensureOnEngine($engineUrl, $engineKey);
                } catch (\Throwable) {
                    // Non-fatal: the engine will return an error we surface below.
                }
            }

            $pieces         = []; // ordered list of WAV byte-strings to splice
            $cursor         = 0.0; // absolute seconds already placed in the output track
            $overflowCount  = 0;

            foreach ($translated as $i => $seg) {
                $windowSeconds = max(0.1, $seg['end'] - $seg['start']);

                $rawWav = $this->synthesizeSegment($engineUrl, $seg['text'], $engineKey, $job->target_language);
                $segPath = $tmpDir . "/seg_{$i}.wav";
                file_put_contents($segPath, $rawWav);

                $actualDuration = $this->probeDuration($segPath) ?: $this->estimateWavDuration($rawWav);
                $ratio = $actualDuration > 0 ? $actualDuration / $windowSeconds : 1.0;

                if ($ratio > 1.0 && $ratio <= self::MAX_STRETCH_RATIO) {
                    // Compress to fit: ffmpeg atempo, clamped to its valid [0.5, 100] range.
                    $stretchedPath = $tmpDir . "/seg_{$i}_fit.wav";
                    $this->runFfmpeg([
                        'ffmpeg', '-y', '-i', $segPath,
                        '-af', 'atempo=' . round($ratio, 4),
                        '-ar', (string) self::SAMPLE_RATE, '-ac', '1',
                        '-f', 'wav', '-acodec', 'pcm_s16le', $stretchedPath,
                    ], "Segment {$i} time-fit");
                    $segAudio = file_get_contents($stretchedPath);
                } elseif ($ratio > self::MAX_STRETCH_RATIO) {
                    // Too far over to stretch naturally — leave at natural
                    // length and let the timeline drift (see class docblock).
                    $overflowCount++;
                    $segAudio = $rawWav;
                } else {
                    $segAudio = $rawWav;
                }

                // Pad with silence up to this segment's original start time,
                // but only if we haven't already drifted past it (an earlier
                // overflow can push the cursor beyond the next segment's
                // nominal start — in that case we just append immediately).
                if ($cursor < $seg['start']) {
                    $silenceSeconds = $seg['start'] - $cursor;
                    $pieces[] = $this->generateSilenceWav($silenceSeconds);
                    $cursor += $silenceSeconds;
                }

                $pieces[] = $segAudio;
                $cursor  += $this->estimateWavDuration($segAudio);

                $pct = 45 + (int) round((($i + 1) / max(1, count($translated))) * 35);
                $job->update(['progress' => min(80, $pct)]);
            }

            $job->update(['segment_overflow_count' => $overflowCount]);
            if ($overflowCount > 0) {
                Log::info("VideoDubbingJob {$job->id}: {$overflowCount}/" . count($translated)
                    . ' segment(s) exceeded the ' . self::MAX_STRETCH_RATIO . 'x stretch ceiling and were left at natural length.');
            }

            $dubbedTrack = $this->spliceWavs($pieces);
            $dubbedTrackPath = $tmpDir . '/dubbed_track.wav';
            file_put_contents($dubbedTrackPath, $dubbedTrack);

            // ── 6. Mux dubbed audio onto the original video ──────────────
            $this->advance($job, $log, 'muxing', 85, 'Combining dubbed audio with the original video…');

            $outputPath = $tmpDir . '/output.mp4';
            $this->runFfmpeg([
                'ffmpeg', '-y',
                '-i', $videoPath,
                '-i', $dubbedTrackPath,
                '-map', '0:v:0', '-map', '1:a:0',
                '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
                $outputPath,
            ], 'Final mux');

            // ── Store result ───────────────────────────────────────────
            // Same 'video/' prefix as the source upload (see
            // VideoDubbingController::submit) — keeps this cleanly
            // separable from audio keys when sharing one S3 bucket.
            $resultPath = 'video/' . $job->user_id . '/' . $job->id . '.mp4';
            Storage::disk('video')->put($resultPath, file_get_contents($outputPath));

            if ($user) {
                SynthesisQuota::record($user);
            }

            $job->update([
                'status'             => 'done',
                'progress'           => 100,
                'result_video_path'  => $resultPath,
                'duration_seconds'   => $videoDuration ?: $cursor,
                'ended_at'           => now(),
            ]);
            $this->updateActivityLog($log, 'Video dubbing complete', 'done', now());

        } catch (\Throwable $e) {
            Log::warning("VideoDubbingJob {$job->id} failed: {$e->getMessage()}");
            $job->update([
                'status'   => 'failed',
                'error'    => $this->truncate($e->getMessage(), 500),
                'ended_at' => now(),
            ]);
            $this->updateActivityLog($log, 'Video dubbing failed: ' . $e->getMessage(), 'failed', now());
        } finally {
            // Best-effort cleanup of the scratch directory — this is a
            // background job with no request lifecycle to rely on for
            // temp-file GC, so explicit cleanup matters here.
            $this->rrmdir($tmpDir);
        }
    }

    public function failed(\Throwable $exception): void
    {
        $job = DubbingJob::find($this->dubbingJobId);
        if ($job && $job->status !== 'failed') {
            $job->update([
                'status'   => 'failed',
                'error'    => $this->truncate($exception->getMessage(), 500),
                'ended_at' => now(),
            ]);
        }
    }

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

    private function translateSegment(string $engineUrl, string $text, string $sourceLang, string $targetLang): string
    {
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
                'text'        => $text,
                'source_lang' => $sourceLang,
                'target_lang' => $targetLang,
            ]);

        if (! $resp->successful()) {
            throw new \RuntimeException("Segment translation failed ({$resp->status()}): {$resp->body()}");
        }

        return $resp->json('translated_text') ?? $text;
    }

    /** Submit + poll + fetch one segment's synthesis. Mirrors BulkSynthesisJob::submitAndFetch. */
    private function synthesizeSegment(string $engineUrl, string $text, string $engineKey, string $language): string
    {
        $pending = Http::withHeaders($this->engineHeaders())
            ->retry(2, 500, throw: false)
            ->asMultipart()
            ->attach('text', $text)
            ->attach('language', $language)
            ->attach('tts_engine', 'xtts'); // XTTS: broadest language coverage, no GPU-only gate — safest default for a first dubbing pass

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

    /** Silence WAV of the given duration, same format as engine output (mono/16-bit/22050Hz). */
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

    private function runFfmpeg(array $cmd, string $context): void
    {
        $proc = proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (! is_resource($proc)) {
            throw new \RuntimeException("{$context}: could not start ffmpeg process.");
        }
        $stderr = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $exitCode = proc_close($proc);

        if ($exitCode !== 0) {
            throw new \RuntimeException("{$context} failed (ffmpeg exit {$exitCode}): " . $this->truncate($stderr, 300));
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
