<?php

namespace App\Jobs;

use App\Jobs\Concerns\DubbingPipelineHelpers;
use App\Models\VideoProjectAsset;
use App\Services\EngineResolver;
use App\Services\SynthesisQuota;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Task #15 (Video Studio) Phase 4 — second half of the "extract audio →
 * transcribe → clone-resynthesize" feature. Reads an 'extracted_audio'
 * asset's (possibly user-edited) `transcript_json` exactly as it stands
 * and synthesizes it into a new 'synthesized_audio' asset.
 *
 * Deliberately simpler than FinalizeDubbingJob: there's no target video
 * timeline to fit segments to, so this skips ALL of that job's
 * stretch/pad/drift-recovery machinery — segments are synthesized in
 * order and concatenated with a small fixed pause between them (see
 * SEGMENT_GAP_SECONDS), same spliceWavs()/generateSilenceWav() primitives
 * dubbing already uses, just without the per-window timing math. See
 * that job's own docblock for why there's no ActivityLog entry yet either.
 */
class SynthesizeAudioAssetJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels, DubbingPipelineHelpers;

    public int $timeout = 1800;
    public int $tries   = 1;

    /** Short natural-sounding pause inserted between concatenated segments — there's no original pacing to preserve here (unlike dubbing's window-fit), so this is just enough to keep sentences from running together. */
    private const SEGMENT_GAP_SECONDS = 0.35;

    public function __construct(
        /** The 'synthesized_audio' placeholder asset (status='processing') created by VideoProjectController::resynthesize(). */
        public readonly string $assetId,
        /** The 'extracted_audio' asset whose transcript_json is being synthesized — read at dispatch time, same "don't re-resolve via parent_asset_id mid-flight" reasoning as ExtractAudioAssetJob. */
        public readonly string $sourceAssetId,
        public readonly int $userId,
        public readonly string $voiceProfileId,
        public readonly string $language,
        public readonly ?string $engine,
    ) {}

    public function handle(): void
    {
        $asset = VideoProjectAsset::find($this->assetId);
        if (! $asset) {
            Log::warning("SynthesizeAudioAssetJob: asset {$this->assetId} not found, skipping.");
            return;
        }
        if ($asset->status !== 'processing') {
            Log::info("SynthesizeAudioAssetJob {$asset->id}: status is {$asset->status}, not 'processing' — skipping.");
            return;
        }

        $source = VideoProjectAsset::find($this->sourceAssetId);
        $segments = $source?->transcript_json;
        if (! $source || empty($segments)) {
            $asset->update(['status' => 'failed', 'error' => 'No transcript found to synthesize — the source clip may have been deleted or never finished transcribing.']);
            return;
        }
        // Same "possibly user-edited start/end" sort guarantee
        // FinalizeDubbingJob applies — not load-bearing for this job's
        // math (no timing-fit here), but keeps segment order sane if the
        // review UI ever allows reordering later.
        usort($segments, fn($a, $b) => $a['start'] <=> $b['start']);

        $user = \App\Models\User::find($this->userId);

        $tmpDir = sys_get_temp_dir() . '/vssynth_' . $asset->id;
        @mkdir($tmpDir, 0700, true);

        try {
            if ($user && ! SynthesisQuota::hasRemaining($user)) {
                throw new \RuntimeException('Synthesis quota exceeded for this plan period.');
            }

            $engineUrl = rtrim(EngineResolver::activeUrl(), '/');
            $engineKey = $this->resolveEngineKey($this->userId, $this->voiceProfileId);
            $ttsEngine = $this->engine ?: 'xtts';

            $pieces = [];
            $failedCount = 0;
            $skippedCount = 0;

            foreach ($segments as $i => $seg) {
                $text = trim((string) ($seg['text'] ?? ''));
                // Same empty/degenerate-text guard FinalizeDubbingJob uses
                // before ever reaching the engine — an empty or muted
                // segment (user deleted its text in review) is just
                // skipped entirely rather than padded with silence, since
                // there's no fixed window here for silence to fill.
                if ($text === '' || preg_match('/\p{L}|\p{N}/u', $text) !== 1) {
                    $skippedCount++;
                    continue;
                }

                if (! empty($pieces)) {
                    $pieces[] = $this->generateSilenceWav(self::SEGMENT_GAP_SECONDS);
                }

                try {
                    $rawWav = $this->synthesizeSegment($engineUrl, $text, $engineKey, $this->language, $ttsEngine);
                } catch (\Throwable $e) {
                    $failedCount++;
                    Log::warning("SynthesizeAudioAssetJob {$asset->id}: segment {$i} failed, skipping — {$e->getMessage()}");
                    continue;
                }

                $segPath = $tmpDir . "/seg_{$i}.wav";
                file_put_contents($segPath, $rawWav);

                $normPath = $tmpDir . "/seg_{$i}_norm.wav";
                $this->runFfmpeg([
                    'ffmpeg', '-y', '-i', $segPath,
                    '-af', 'highpass=f=80,loudnorm=I=-16:LRA=11:TP=-1.5',
                    '-ar', (string) self::SAMPLE_RATE, '-ac', '1',
                    '-f', 'wav', '-acodec', 'pcm_s16le', $normPath,
                ], "Segment {$i} loudness normalization");

                $pieces[] = file_get_contents($normPath);
            }

            if (count($pieces) === 0) {
                throw new \RuntimeException('Nothing to synthesize — every segment was empty or failed.');
            }
            if (count($segments) > 0 && ($failedCount / count($segments)) > 0.4) {
                throw new \RuntimeException(
                    "Synthesis failed for {$failedCount} of " . count($segments) . ' segments — '
                    . 'this looks like an engine problem rather than isolated bad text.'
                );
            }
            if ($skippedCount > 0 || $failedCount > 0) {
                Log::info("SynthesizeAudioAssetJob {$asset->id}: {$skippedCount} segment(s) skipped (empty text), {$failedCount} failed synthesis.");
            }

            $track = $this->spliceWavs($pieces);
            $outputPath = $tmpDir . '/output.wav';
            file_put_contents($outputPath, $track);
            $duration = $this->probeDuration($outputPath) ?: $this->estimateWavDuration($track);

            $storedPath = 'video/' . $this->userId . '/project-assets/' . $asset->id . '_synthesized.wav';
            Storage::disk('video')->put($storedPath, $track);

            if ($user) {
                SynthesisQuota::record($user);
            }

            $asset->update([
                'storage_path'     => $storedPath,
                'duration_seconds' => $duration,
                'status'           => 'ready',
                'error'            => null,
            ]);
        } catch (\Throwable $e) {
            Log::warning("SynthesizeAudioAssetJob {$asset->id} failed: {$e->getMessage()}");
            $asset->update(['status' => 'failed', 'error' => $this->truncate($e->getMessage(), 500)]);
        } finally {
            $this->rrmdir($tmpDir);
        }
    }

    public function failed(\Throwable $exception): void
    {
        $asset = VideoProjectAsset::find($this->assetId);
        if ($asset && $asset->status === 'processing') {
            $asset->update(['status' => 'failed', 'error' => $this->truncate($exception->getMessage(), 500)]);
        }
    }
}
