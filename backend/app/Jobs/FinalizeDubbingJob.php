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
            $emptySegmentCount    = 0; // no real speech content (incl. the review-timeline "Mute" action, which blanks text) — substituted with silence, never sent to the engine
            $failedSynthesisCount = 0; // engine genuinely couldn't synthesize this segment — substituted with silence rather than failing the whole job

            foreach ($translated as $i => $seg) {
                $windowSeconds = max(0.1, (float) $seg['end'] - (float) $seg['start']);

                // A segment can have no real speech content — translation
                // came back empty, or the review timeline's "Mute" action
                // deliberately blanked the text (see DubbingTimelineEditor::
                // muteSegment — its own comment documents that finalize is
                // expected to pad silence here, so this is that contract).
                // Sending empty/degenerate text into TTS is exactly what
                // crashed Chatterbox in production before ("max(): Expected
                // reduction dim 1 to have non-zero size" — no phonemes to
                // align against for empty input), so this is checked BEFORE
                // ever reaching the engine, not left to fail there.
                $hasSpeechContent = trim($seg['text']) !== '' && preg_match('/\p{L}|\p{N}/u', $seg['text']) === 1;
                if (! $hasSpeechContent) {
                    $emptySegmentCount++;
                    $segStart = (float) $seg['start'];
                    if ($cursor < $segStart) {
                        $pieces[] = $this->generateSilenceWav($segStart - $cursor);
                        $cursor = $segStart;
                    }
                    $pieces[] = $this->generateSilenceWav($windowSeconds);
                    $cursor  += $windowSeconds;

                    $pct = 50 + (int) round((($i + 1) / max(1, count($translated))) * 35);
                    $job->update(['progress' => min(85, $pct)]);
                    continue;
                }

                // Belt-and-suspenders: even non-empty text can occasionally
                // crash a given engine on some edge case not seen yet. One
                // bad segment shouldn't fail an otherwise-fine dub — swap in
                // silence for that segment and keep going. If MOST segments
                // fail this way, that's not an isolated bad-text problem,
                // it's the engine itself being broken — the check after
                // this loop escalates that into a real failure instead of
                // quietly handing back an almost-entirely-silent "success".
                try {
                    $rawWav = $this->synthesizeSegment($engineUrl, $seg['text'], $engineKey, $job->target_language, $ttsEngine);
                } catch (\Throwable $e) {
                    $failedSynthesisCount++;
                    Log::warning("FinalizeDubbingJob {$job->id}: segment {$i} synthesis failed, substituting silence — {$e->getMessage()}");

                    $segStart = (float) $seg['start'];
                    if ($cursor < $segStart) {
                        $pieces[] = $this->generateSilenceWav($segStart - $cursor);
                        $cursor = $segStart;
                    }
                    $pieces[] = $this->generateSilenceWav($windowSeconds);
                    $cursor  += $windowSeconds;

                    $pct = 50 + (int) round((($i + 1) / max(1, count($translated))) * 35);
                    $job->update(['progress' => min(85, $pct)]);
                    continue;
                }

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

            // If most segments failed synthesis, this isn't "a few bad
            // segments" — the engine/model itself is broken for this job
            // (wrong voice profile on this engine, model crash-looping,
            // server down mid-job, etc). Handing back a "done" video that's
            // 80% silence would be worse than a clear failure the user can
            // act on, so escalate past a fixed threshold instead of
            // silently declaring success. Empty/muted segments are NOT
            // counted here — those are deliberate, not a sign of trouble.
            if (count($translated) > 0 && ($failedSynthesisCount / count($translated)) > 0.4) {
                throw new \RuntimeException(
                    "Synthesis failed for {$failedSynthesisCount} of " . count($translated) . ' segments — '
                    . 'this looks like an engine problem rather than isolated bad text. Check that the '
                    . strtoupper($ttsEngine) . ' engine is healthy and that this voice profile works on it.'
                );
            }

            if ($emptySegmentCount > 0 || $failedSynthesisCount > 0) {
                Log::info("FinalizeDubbingJob {$job->id}: {$emptySegmentCount} segment(s) had no speech content "
                    . "(silence substituted, never sent to the engine); {$failedSynthesisCount} segment(s) failed "
                    . 'synthesis and were substituted with silence instead of failing the job.');
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
