<?php

namespace App\Jobs;

use App\Jobs\Concerns\DubbingPipelineHelpers;
use App\Models\ActivityLog;
use App\Models\DubbingJob;
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
 * Phase 2 of the (Aug 22, 2026) two-phase dubbing pipeline — picks up
 * where PrepareDubbingJob left off. Reads $job->segments_json exactly as
 * it currently stands (i.e. including any edits the user made on the
 * review timeline — retimed start/end, rewritten text — via
 * VideoDubbingController::updateSegments()) and runs the original
 * synthesize → stretch/pad/recover-drift → splice → mux pipeline against
 * it.
 *
 * On failure this deliberately reverts the job to 'ready_for_review'
 * rather than 'failed': the expensive, quota-charged translation work is
 * already done and stored, so a synthesis-side hiccup (engine down, mux
 * error, etc.) shouldn't force the user to redo it or spend another
 * translation credit — they just fix whatever's wrong and hit "Generate"
 * again from the same reviewed segments.
 */
class FinalizeDubbingJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels, DubbingPipelineHelpers;

    public int $timeout = 3600;
    public int $tries   = 1;

    public function __construct(
        public readonly string $dubbingJobId,
    ) {}

    public function handle(): void
    {
        $job = DubbingJob::find($this->dubbingJobId);
        if (! $job) {
            Log::warning("FinalizeDubbingJob: job {$this->dubbingJobId} not found, skipping.");
            return;
        }

        // Guard against a stale/duplicate dispatch (e.g. double-click on
        // "Generate") — only ever finalize from the review state.
        if ($job->status !== 'synthesizing') {
            Log::info("FinalizeDubbingJob {$job->id}: status is {$job->status}, not 'synthesizing' — skipping.");
            return;
        }

        $translated = json_decode($job->segments_json ?? '[]', true);
        if (! is_array($translated) || empty($translated)) {
            $job->update(['status' => 'ready_for_review', 'error' => 'No reviewed segments found to synthesize.']);
            return;
        }
        // Sort by (possibly user-edited) start time — the review timeline
        // doesn't let segments cross each other, but this is a cheap
        // guarantee against relying on array order.
        usort($translated, fn($a, $b) => $a['start'] <=> $b['start']);

        $user = $job->user;
        $log  = $job->activity_log_id ? ActivityLog::find($job->activity_log_id) : null;

        $tmpDir = sys_get_temp_dir() . '/dubfinal_' . $job->id;
        @mkdir($tmpDir, 0700, true);

        try {
            if ($user && ! SynthesisQuota::hasRemaining($user)) {
                throw new \RuntimeException('Synthesis quota exceeded for this plan period.');
            }

            $engineUrl = rtrim(EngineResolver::activeUrl(), '/');
            $engineKey = $this->resolveEngineKey($job->user_id, $job->voice_profile_id);
            $ttsEngine = $job->engine ?: 'xtts';

            // Re-download the source video — PrepareDubbingJob's tmp dir
            // (and its copy) is long gone by the time the user finishes
            // reviewing.
            $videoPath = $tmpDir . '/source.mp4';
            $sourceStream = Storage::disk('video')->readStream($job->source_video_path);
            if (! $sourceStream) {
                throw new \RuntimeException('Could not read uploaded source video from storage.');
            }
            file_put_contents($videoPath, stream_get_contents($sourceStream));
            fclose($sourceStream);
            $videoDuration = $this->probeDuration($videoPath) ?: $job->duration_seconds;

            $this->advance($job, $log, 'synthesizing', 50,
                'Synthesizing ' . count($translated) . ' reviewed segments…');

            $pieces          = []; // ordered list of WAV byte-strings to splice
            $cursor          = 0.0; // absolute seconds already placed in the output track
            $overflowCount   = 0;
            $driftRecovered  = 0.0;
            $peakDrift       = 0.0;

            foreach ($translated as $i => $seg) {
                $windowSeconds = max(0.1, (float) $seg['end'] - (float) $seg['start']);

                $rawWav = $this->synthesizeSegment($engineUrl, $seg['text'], $engineKey, $job->target_language, $ttsEngine);
                $segPath = $tmpDir . "/seg_{$i}.wav";
                file_put_contents($segPath, $rawWav);

                // Loudness-normalize each segment before measuring/fitting
                // its duration (see BulkSynthesisJob::postProcessAudio for
                // the same EBU R128 pass applied to regular synthesis).
                $normPath = $tmpDir . "/seg_{$i}_norm.wav";
                $this->runFfmpeg([
                    'ffmpeg', '-y', '-i', $segPath,
                    '-af', 'highpass=f=80,loudnorm=I=-16:LRA=11:TP=-1.5',
                    '-ar', (string) self::SAMPLE_RATE, '-ac', '1',
                    '-f', 'wav', '-acodec', 'pcm_s16le', $normPath,
                ], "Segment {$i} loudness normalization");
                $segPath = $normPath;

                $actualDuration = $this->probeDuration($segPath) ?: $this->estimateWavDuration($rawWav);
                $ratio = $actualDuration > 0 ? $actualDuration / $windowSeconds : 1.0;

                $driftBefore = max(0.0, $cursor - (float) $seg['start']);
                $peakDrift   = max($peakDrift, $driftBefore);

                if ($ratio > 1.0 && $ratio <= self::MAX_STRETCH_RATIO) {
                    $stretchedPath = $tmpDir . "/seg_{$i}_fit.wav";
                    $this->runFfmpeg([
                        'ffmpeg', '-y', '-i', $segPath,
                        '-af', 'atempo=' . round($ratio, 4),
                        '-ar', (string) self::SAMPLE_RATE, '-ac', '1',
                        '-f', 'wav', '-acodec', 'pcm_s16le', $stretchedPath,
                    ], "Segment {$i} time-fit");
                    $segAudio = file_get_contents($stretchedPath);
                } elseif ($ratio > self::MAX_STRETCH_RATIO) {
                    $overflowCount++;
                    $segAudio = file_get_contents($segPath);
                } elseif ($driftBefore > 0.05) {
                    $recoverable  = min($driftBefore, $windowSeconds * (self::RECOVERY_STRETCH_RATIO - 1.0));
                    $targetWindow = max(0.1, $windowSeconds - $recoverable);
                    $recoverRatio = min(self::RECOVERY_STRETCH_RATIO, $actualDuration / $targetWindow);

                    if ($recoverRatio > 1.02) {
                        $recoverPath = $tmpDir . "/seg_{$i}_recover.wav";
                        $this->runFfmpeg([
                            'ffmpeg', '-y', '-i', $segPath,
                            '-af', 'atempo=' . round($recoverRatio, 4),
                            '-ar', (string) self::SAMPLE_RATE, '-ac', '1',
                            '-f', 'wav', '-acodec', 'pcm_s16le', $recoverPath,
                        ], "Segment {$i} drift recovery");
                        $segAudio = file_get_contents($recoverPath);
                        $driftRecovered += ($actualDuration - $this->probeDuration($recoverPath));
                    } else {
                        $segAudio = file_get_contents($segPath);
                    }
                } else {
                    $segAudio = file_get_contents($segPath);
                }

                // Pad with silence up to this segment's (possibly
                // user-edited) start time, if the cursor hasn't already
                // caught up or overshot it.
                $segStart = (float) $seg['start'];
                if ($cursor < $segStart) {
                    $pieces[] = $this->generateSilenceWav($segStart - $cursor);
                    $cursor = $segStart;
                }

                $pieces[] = $segAudio;
                $cursor  += $this->estimateWavDuration($segAudio);

                $pct = 50 + (int) round((($i + 1) / max(1, count($translated))) * 35);
                $job->update(['progress' => min(85, $pct)]);
            }

            $job->update(['segment_overflow_count' => $overflowCount]);
            if ($overflowCount > 0) {
                Log::info("FinalizeDubbingJob {$job->id}: {$overflowCount}/" . count($translated)
                    . ' segment(s) exceeded the ' . self::MAX_STRETCH_RATIO . 'x stretch ceiling and were left at natural length. '
                    . 'Peak drift: ' . round($peakDrift, 2) . 's, actively recovered: ' . round($driftRecovered, 2) . 's.');
            }

            $dubbedTrack = $this->spliceWavs($pieces);
            $dubbedTrackPath = $tmpDir . '/dubbed_track.wav';
            file_put_contents($dubbedTrackPath, $dubbedTrack);

            $this->advance($job, $log, 'muxing', 90, 'Muxing dubbed audio onto video…');

            $outputPath = $tmpDir . '/output.mp4';
            $this->runFfmpeg([
                'ffmpeg', '-y',
                '-i', $videoPath,
                '-i', $dubbedTrackPath,
                '-map', '0:v:0', '-map', '1:a:0',
                '-c:v', 'copy',
                '-c:a', 'aac', '-b:a', '192k',
                '-shortest',
                $outputPath,
            ], 'Final mux');

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
            Log::warning("FinalizeDubbingJob {$job->id} failed: {$e->getMessage()}");
            // Revert to 'ready_for_review', not 'failed' — see class
            // docblock. segments_json is untouched, so the user can just
            // hit "Generate" again without redoing translation.
            $job->update([
                'status' => 'ready_for_review',
                'error'  => $this->truncate($e->getMessage(), 500),
            ]);
            $this->updateActivityLog($log, 'Video dubbing (finalize) failed: ' . $e->getMessage(), 'failed', now());
        } finally {
            $this->rrmdir($tmpDir);
        }
    }

    public function failed(\Throwable $exception): void
    {
        $job = DubbingJob::find($this->dubbingJobId);
        if ($job && $job->status === 'synthesizing') {
            $job->update([
                'status' => 'ready_for_review',
                'error'  => $this->truncate($exception->getMessage(), 500),
            ]);
        }
    }
}
