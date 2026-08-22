<?php

namespace App\Jobs;

use App\Jobs\Concerns\DubbingPipelineHelpers;
use App\Models\ActivityLog;
use App\Models\DubbingJob;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use App\Services\TranslationQuota;
use App\Services\SynthesisQuota;
use App\Services\EngineResolver;

/**
 * Phase 1 of the (Aug 22, 2026) two-phase dubbing pipeline — see task #6
 * in docs/ENHANCEMENT_TASKS.md for why this was split out of the original
 * one-shot VideoDubbingJob. Runs everything up through translation, then
 * STOPS at 'ready_for_review' instead of synthesizing immediately, so the
 * user can edit segment timing/text on the review timeline before
 * FinalizeDubbingJob spends any synthesis quota.
 *
 *   1. Extract audio from the uploaded video (ffmpeg).
 *   2. Transcribe with per-segment timestamps (ai-engine's
 *      /transcribe/segments).
 *   3. Translate each segment's text, with adjacent segments' original
 *      text as context (ai-engine's /translate).
 *   4. Store the result as segments_json and stop.
 */
class PrepareDubbingJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels, DubbingPipelineHelpers;

    public int $timeout = 1800;
    public int $tries   = 1;

    public function __construct(
        public readonly string $dubbingJobId,
    ) {}

    public function handle(): void
    {
        $job = DubbingJob::find($this->dubbingJobId);
        if (! $job) {
            Log::warning("PrepareDubbingJob: job {$this->dubbingJobId} not found, skipping.");
            return;
        }

        $user = $job->user;
        $log  = $job->activity_log_id ? ActivityLog::find($job->activity_log_id) : null;

        $tmpDir = sys_get_temp_dir() . '/dubprep_' . $job->id;
        @mkdir($tmpDir, 0700, true);

        try {
            // Translation quota is reserved now (checkAndRecord is atomic)
            // since this phase definitely uses it. Synthesis quota is only
            // CHECKED here (not recorded) as an early fail-fast — the
            // actual spend happens in FinalizeDubbingJob, once we know how
            // many segments will really be synthesized after any user
            // edits.
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

            // ── 3. Translate each segment, with neighbor context ──────────
            $this->advance($job, $log, 'translating', 40,
                'Translating ' . count($segments) . ' segments…');

            $sourceLang = $segments[0]['detected_language'] ?? ($job->source_language ?: 'en');
            $reviewSegments = [];
            foreach ($segments as $i => $seg) {
                $contextBefore = $i > 0 ? $segments[$i - 1]['text'] : '';
                $contextAfter  = $i < count($segments) - 1 ? $segments[$i + 1]['text'] : '';

                $reviewSegments[] = [
                    'id'       => (string) Str::uuid(),
                    'start'    => round((float) $seg['start'], 3),
                    'end'      => round((float) $seg['end'], 3),
                    // Original transcript text — kept for reference in the
                    // review UI and re-shown as context if the job is
                    // retried; never editable by the client.
                    'original' => $seg['text'],
                    'text'     => $this->translateSegment(
                        $engineUrl, $seg['text'], $sourceLang, $job->target_language,
                        $contextBefore, $contextAfter
                    ),
                ];
                if ($i % 5 === 0) {
                    $pct = 40 + (int) round(($i / max(1, count($segments))) * 45);
                    $job->update(['progress' => $pct]);
                }
            }

            // ── 4. Stop here — hand off to the review timeline ────────────
            $job->update([
                'status'         => 'ready_for_review',
                'progress'       => 90,
                'segments_json'  => json_encode($reviewSegments),
                'source_language' => $job->source_language ?: $sourceLang,
                'duration_seconds' => $videoDuration,
            ]);
            $this->updateActivityLog($log, 'Ready to review — ' . count($reviewSegments) . ' segments translated', 'running');

        } catch (\Throwable $e) {
            Log::warning("PrepareDubbingJob {$job->id} failed: {$e->getMessage()}");
            $job->update([
                'status'   => 'failed',
                'error'    => $this->truncate($e->getMessage(), 500),
                'ended_at' => now(),
            ]);
            $this->updateActivityLog($log, 'Video dubbing failed: ' . $e->getMessage(), 'failed', now());
        } finally {
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
}
