<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;

/**
 * Stateless audio/synthesis primitives shared between the main dubbing
 * pipeline (App\Jobs\VideoDubbingJob) and the per-segment advanced-editing
 * endpoints (App\Http\Controllers\VideoDubbingController::resynthesizeSegment/
 * remux — Tier 1 of the "advanced dubbing" plan, see docs/ENHANCEMENT_TASKS.md
 * task #6).
 *
 * Extracted verbatim from VideoDubbingJob rather than reimplemented, so a
 * single-segment resynthesis or a remux-only pass goes through exactly the
 * same WAV-splicing and TTS-calling code as the original full job — no
 * second copy of the delicate chunk-parsing/atempo logic to keep in sync.
 */
class DubbingAudio
{
    /**
     * Both TTS engines synthesize at 24000Hz natively (see ai-engine/main.py:
     * xtts_synthesize_with_latents's sf.write(..., 24000, ...) and F5's
     * sr = 24000). Shared here so VideoDubbingJob and the per-segment
     * advanced-editing endpoints can't drift apart on this value.
     */
    public const SAMPLE_RATE = 24000;

    /**
     * Segments that overrun their window by more than this ratio are left
     * at natural length instead of atempo-stretched — beyond ~15-20% speed
     * change, stretched TTS starts sounding artificial. Shared for the same
     * reason as SAMPLE_RATE above.
     */
    public const MAX_STRETCH_RATIO = 1.20;

    public static function engineHeaders(): array
    {
        $key = config('services.ai_engine.key', '');
        return $key ? ['X-Engine-Key' => $key] : [];
    }

    /**
     * Same shape as a simple head-truncate, but keeps the END of the text
     * instead of the start — ffmpeg always prints its version/build banner
     * first on stderr and the actual fatal error last, right before exit.
     */
    public static function tailOutput(string $text, int $max): string
    {
        $text = trim(preg_replace('/\s+/', ' ', $text));
        return strlen($text) > $max ? '…' . substr($text, -$max) : $text;
    }

    public static function runFfmpeg(array $cmd, string $context): void
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
            throw new \RuntimeException("{$context} failed (ffmpeg exit {$exitCode}): " . self::tailOutput($stderr, 500));
        }
    }

    public static function probeDuration(string $path): ?float
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

    /** Silence WAV of the given duration, matching the pipeline's fixed PCM format. */
    public static function generateSilenceWav(float $seconds, int $sampleRate): string
    {
        $seconds = max(0.0, $seconds);
        $tmp = tempnam(sys_get_temp_dir(), 'dub_sil_') . '.wav';
        self::runFfmpeg([
            'ffmpeg', '-y',
            '-f', 'lavfi', '-i', 'anullsrc=r=' . $sampleRate . ':cl=mono',
            '-t', (string) $seconds,
            '-acodec', 'pcm_s16le', $tmp,
        ], 'Silence padding');
        $data = file_get_contents($tmp);
        @unlink($tmp);
        return $data ?: '';
    }

    /**
     * Splice multiple PCM WAV blobs into one continuous track.
     *
     * Every WAV this receives (segment audio, silence padding) was produced
     * by our own ffmpeg calls with a fixed, known format — mono, 16-bit PCM
     * at $sampleRate — so rather than borrowing any input file's raw header
     * bytes, this builds one fresh canonical 44-byte header from those
     * known constants, and uses findWavDataChunk() to correctly locate each
     * input's actual 'data' payload.
     *
     * This used to instead assume every WAV was exactly the minimal
     * 44-byte-header layout, slicing at a hardcoded offset for both the
     * borrowed header and every payload. ffmpeg's WAV muxer can — and,
     * depending on what metadata the upstream TTS engine's own output
     * carried, sometimes did — insert an extra chunk (most commonly a
     * LIST/INFO metadata chunk) between 'fmt ' and 'data'. Slicing at byte
     * 44 in that case corrupted the assembled file two ways at once: it fed
     * that chunk's raw bytes into the concatenated PCM stream as if they
     * were audio samples, AND overwrote unrelated bytes with the wrong
     * size value. That combination is exactly what produced ffmpeg's "too
     * big INFO subchunk" / "no 'data' tag found" failure on final mux.
     *
     * @param string[] $wavs
     */
    public static function spliceWavs(array $wavs, int $sampleRate): string
    {
        $wavs = array_values(array_filter($wavs, fn($w) => strlen($w) > 44));
        if (empty($wavs)) {
            throw new \RuntimeException('No audio segments to splice — dubbing produced no output.');
        }

        $allPcm = '';
        foreach ($wavs as $wav) {
            [$offset, $length] = self::findWavDataChunk($wav);
            $allPcm .= substr($wav, $offset, $length);
        }

        $channels      = 1;
        $bitsPerSample = 16;
        $byteRate      = $sampleRate * $channels * intdiv($bitsPerSample, 8);
        $blockAlign    = $channels * intdiv($bitsPerSample, 8);
        $dataSize      = strlen($allPcm);
        $riffSize      = 36 + $dataSize;

        $header  = 'RIFF' . pack('V', $riffSize) . 'WAVE';
        $header .= 'fmt ' . pack('V', 16) . pack('v', 1) . pack('v', $channels)
                 . pack('V', $sampleRate) . pack('V', $byteRate)
                 . pack('v', $blockAlign) . pack('v', $bitsPerSample);
        $header .= 'data' . pack('V', $dataSize);

        return $header . $allPcm;
    }

    /**
     * Locate the 'data' subchunk within a RIFF/WAVE byte string and return
     * [dataOffset, dataLength] for the actual PCM payload — does NOT assume
     * a fixed 44-byte header. See spliceWavs() for why that assumption was
     * wrong and what it broke.
     *
     * @return array{0:int,1:int} [dataOffset, dataLength]
     */
    public static function findWavDataChunk(string $wav): array
    {
        $len = strlen($wav);
        if ($len < 12 || substr($wav, 0, 4) !== 'RIFF' || substr($wav, 8, 4) !== 'WAVE') {
            throw new \RuntimeException('Not a valid RIFF/WAVE file.');
        }

        $pos = 12; // past the 12-byte RIFF/size/WAVE header
        while ($pos + 8 <= $len) {
            $chunkId   = substr($wav, $pos, 4);
            $chunkSize = unpack('V', substr($wav, $pos + 4, 4))[1] ?? 0;
            $dataStart = $pos + 8;

            if ($chunkId === 'data') {
                $available = max(0, $len - $dataStart);
                return [$dataStart, min($chunkSize, $available)];
            }

            // Every RIFF chunk is padded to an even number of bytes; that
            // pad byte isn't counted in chunkSize, so it must be skipped
            // separately or the next chunk header gets misread by one byte
            // on any chunk with an odd size.
            $pos = $dataStart + $chunkSize + ($chunkSize % 2);
        }

        throw new \RuntimeException("No 'data' chunk found in WAV segment.");
    }

    public static function estimateWavDuration(string $wavData, int $sampleRate): float
    {
        if (strlen($wavData) >= 44) {
            try {
                [, $dataSize] = self::findWavDataChunk($wavData);
            } catch (\Throwable) {
                $dataSize = max(0, strlen($wavData) - 44);
            }
            $byteRate = unpack('V', substr($wavData, 28, 4))[1] ?? 0;
            if ($byteRate > 0 && $dataSize > 0) {
                return round($dataSize / $byteRate, 3);
            }
        }
        $byteRate = $sampleRate * 2; // mono, 16-bit
        $dataBytes = max(0, strlen($wavData) - 44);
        return $byteRate > 0 ? round($dataBytes / $byteRate, 3) : 0.0;
    }

    public static function translateSegment(
        string $engineUrl, string $text, string $sourceLang, string $targetLang,
        string $contextBefore = '', string $contextAfter = ''
    ): string {
        if (trim($text) === '') {
            return '';
        }

        $headers = self::engineHeaders();
        if ($gemini = Settings::get('gemini_api_key')) {
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
    public static function synthesizeSegment(
        string $engineUrl, string $text, ?string $engineKey, string $language, string $ttsEngine,
        int $perSegmentTimeout = 180, int $pollInterval = 2
    ): string {
        $pending = Http::withHeaders(self::engineHeaders())
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

        $deadline = time() + $perSegmentTimeout;
        $status   = 'pending';

        while (time() < $deadline) {
            sleep($pollInterval);

            $statusResp = Http::withHeaders(self::engineHeaders())
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
            throw new \RuntimeException("Timed out waiting for segment job {$jobId} after {$perSegmentTimeout}s");
        }

        $resultResp = Http::withHeaders(self::engineHeaders())
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
}
