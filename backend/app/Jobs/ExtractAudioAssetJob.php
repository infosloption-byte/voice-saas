<?php

namespace App\Jobs;

use App\Jobs\Concerns\DubbingPipelineHelpers;
use App\Models\User;
use App\Models\VideoProjectAsset;
use App\Services\EngineResolver;
use App\Services\TranslationQuota;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Task #15 (Video Studio) Phase 4 — first half of the "extract audio →
 * transcribe → clone-resynthesize" feature. Pulls the audio track off a
 * video bin asset (source or dubbed — VideoProjectController::extractAudio()
 * allows either) and transcribes it into an editable segment list.
 *
 * Same immediate-placeholder-then-poll-on-read shape dubClip() established
 * for 'dubbed' assets, except there's no separate DubbingJob row here: the
 * 'extracted_audio' placeholder asset's own `status`/`error` columns ARE
 * the job's state, and its `transcript_json` is the job's actual output —
 * no ActivityLog/job-table layer, since this is a single-pass job with no
 * meaningful intermediate stages worth surfacing progress for (same
 * reasoning SynthesizeAudioAssetJob's docblock already gives for skipping
 * that layer on its own, structurally identical job).
 *
 * Reuses DubbingPipelineHelpers::runFfmpeg()/probeDuration() (this trait's
 * third caller, after PrepareDubbingJob/FinalizeDubbingJob) for the actual
 * audio extraction — no new ffmpeg work here, just new orchestration
 * around what already exists.
 */
class ExtractAudioAssetJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels, DubbingPipelineHelpers;

    public int $timeout = 900;
    public int $tries   = 1;

    public function __construct(
        /** The 'extracted_audio' placeholder asset (status='processing') created by VideoProjectController::extractAudio(). */
        public readonly string $assetId,
        /** The video asset (source or dubbed) whose audio track is being pulled — read at dispatch time rather than re-resolved via parent_asset_id mid-flight, same reasoning SynthesizeAudioAssetJob uses for its own sourceAssetId. */
        public readonly string $sourceAssetId,
        public readonly int $userId,
    ) {}

    public function handle(): void
    {
        $asset = VideoProjectAsset::find($this->assetId);
        if (! $asset) {
            Log::warning("ExtractAudioAssetJob: asset {$this->assetId} not found, skipping.");
            return;
        }
        if ($asset->status !== 'processing') {
            Log::info("ExtractAudioAssetJob {$asset->id}: status is {$asset->status}, not 'processing' — skipping.");
            return;
        }

        $source = VideoProjectAsset::find($this->sourceAssetId);
        if (! $source || ! $source->storage_path || ! Storage::disk('video')->exists($source->storage_path)) {
            $asset->update([
                'status' => 'failed',
                'error'  => 'The source clip\'s file is missing or has expired — it may have been deleted, or is still dubbing.',
            ]);
            return;
        }

        $user = User::find($this->userId);

        $tmpDir = sys_get_temp_dir() . '/vsextract_' . $asset->id;
        @mkdir($tmpDir, 0700, true);

        try {
            // Same "checkAndRecord is atomic, reserve it up front" reasoning
            // PrepareDubbingJob already uses TranslationQuota for — that job
            // gates its ENTIRE transcribe+translate phase on translation
            // quota rather than inventing a separate transcription bucket,
            // and this job is the same kind of AI-engine-cost transcription
            // call with no dedicated bucket of its own (see task #15's
            // "Open questions" note on why a new quota key isn't invented
            // here casually). Reusing TranslationQuota is the closest
            // existing precedent, not a perfect fit — worth its own quota
            // bucket if/when this feature's usage justifies one.
            if ($user) {
                $quotaBlock = TranslationQuota::checkAndRecord($user);
                if ($quotaBlock !== null) {
                    throw new \RuntimeException($quotaBlock['message'] ?? 'Translation quota exceeded for this plan period.');
                }
            }

            $engineUrl = rtrim(EngineResolver::activeUrl(), '/');

            // ── 1. Download source clip, extract audio ────────────────────
            $videoPath = $tmpDir . '/source';
            $sourceStream = Storage::disk('video')->readStream($source->storage_path);
            if (! $sourceStream) {
                throw new \RuntimeException('Could not read the source clip from storage.');
            }
            file_put_contents($videoPath, stream_get_contents($sourceStream));
            fclose($sourceStream);

            $audioPath = $tmpDir . '/audio.wav';
            $this->runFfmpeg([
                'ffmpeg', '-y', '-i', $videoPath,
                '-vn', '-ar', (string) self::SAMPLE_RATE, '-ac', '1',
                '-f', 'wav', '-acodec', 'pcm_s16le', $audioPath,
            ], 'Audio extraction');

            $duration = $this->probeDuration($audioPath);

            // ── 2. Transcribe with segment timestamps + detected language ──
            $result   = $this->transcribeSegmentsWithLanguage($engineUrl, $audioPath);
            $segments = $result['segments'];
            if (empty($segments)) {
                throw new \RuntimeException('Transcription returned no speech segments.');
            }

            // 'original'/'text' start identical — there's no translation
            // step in this pipeline (unlike dubbing), so 'text' only
            // diverges from 'original' once the user edits it via
            // updateTranscript(). Same {id, start, end, original, text}
            // shape PrepareDubbingJob's reviewSegments already uses, so
            // TranscriptReviewDialog's segment rows work identically to
            // DubbingTimelineEditor's.
            $transcript = array_map(fn($seg) => [
                'id'       => (string) Str::uuid(),
                'start'    => round((float) $seg['start'], 3),
                'end'      => round((float) $seg['end'], 3),
                'original' => $seg['text'],
                'text'     => $seg['text'],
            ], $segments);

            // ── 3. Store the extracted track + transcript ──────────────────
            $storedPath = 'video/' . $this->userId . '/project-assets/' . $asset->id . '_extracted.wav';
            Storage::disk('video')->put($storedPath, file_get_contents($audioPath));

            $asset->update([
                'storage_path'      => $storedPath,
                'duration_seconds'  => $duration,
                'transcript_json'   => $transcript,
                'detected_language' => $result['language'] ?: null,
                'status'            => 'ready',
                'error'             => null,
            ]);
        } catch (\Throwable $e) {
            Log::warning("ExtractAudioAssetJob {$asset->id} failed: {$e->getMessage()}");
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
