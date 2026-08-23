<?php

namespace App\Jobs;

use App\Jobs\Concerns\DubbingPipelineHelpers;
use App\Models\ActivityLog;
use App\Models\VideoProject;
use App\Models\VideoProjectClip;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Task #6a (Video Studio) Phase 4 — the render/export job. Consumes a
 * VideoProject's `timeline_json` (built entirely in Phase 3's studio UI,
 * unchanged here) into one concatenated output video.
 *
 * Reuses DubbingPipelineHelpers purely for its ffmpeg plumbing
 * (runFfmpeg's hang-detection, probeDuration, tailOutput, rrmdir,
 * truncate) exactly as PrepareDubbingJob/FinalizeDubbingJob already do.
 * This job is now the THIRD caller of that trait, and — via
 * VideoProjectController::clipFile()'s streamVideo(), which duplicates
 * VideoDubbingController::streamVideo() — also effectively the second
 * caller of that duplicated method too. Worth actually promoting both
 * to a shared Service next time either needs a change, rather than
 * editing three/two copies; not doing that refactor in this pass since
 * nothing about the ffmpeg helpers themselves needed to change.
 *
 * Approach: every timeline entry's clip is trimmed to
 * [trim_in, trim_out] AND re-encoded to one fixed spec (h264/aac, fixed
 * resolution/framerate) in the same ffmpeg pass, because clips sitting
 * in the same bin can genuinely differ in codec/resolution/framerate —
 * an uploaded source clip vs. a dubbed variant that came out of
 * FinalizeDubbingJob's own `-c:v copy` remux of THAT clip's original
 * codec — and the concat DEMUXER used for the final join (cheap: just a
 * remux, not a second full decode) requires every input to already match.
 * Normalizing once per segment here, then concatenating with `-c copy`,
 * is cheaper than joining with the concat FILTER, which would re-encode
 * the whole timeline a second time to reconcile mismatched inputs.
 */
class RenderVideoProjectJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels, DubbingPipelineHelpers;

    public int $timeout = 3600;
    public int $tries   = 1;

    /**
     * Fixed spec every segment is normalized to before concat. 1080p30
     * is a safe common ceiling for the short-form bin clips this feature
     * targets — revisit if projects start needing 4K or higher frame
     * rates preserved through the render.
     */
    private const OUT_WIDTH  = 1920;
    private const OUT_HEIGHT = 1080;
    private const OUT_FPS    = 30;

    public function __construct(
        public readonly string $videoProjectId,
    ) {}

    public function handle(): void
    {
        $project = VideoProject::find($this->videoProjectId);
        if (! $project) {
            Log::warning("RenderVideoProjectJob: project {$this->videoProjectId} not found, skipping.");
            return;
        }

        // Guard against a stale/duplicate dispatch (e.g. double-click on
        // "Render") — same reasoning as FinalizeDubbingJob's status guard.
        if ($project->status !== 'rendering') {
            Log::info("RenderVideoProjectJob {$project->id}: status is {$project->status}, not 'rendering' — skipping.");
            return;
        }

        $entries = collect($project->timeline_json ?? []);
        if ($entries->isEmpty()) {
            // Controller already validates this before dispatch, but the
            // job re-checks rather than trusting a timeline that could
            // have been edited to empty in the gap between request and
            // this job actually running.
            $project->update(['status' => 'failed', 'error' => 'Timeline is empty — add clips to it before rendering.']);
            return;
        }

        $log = ActivityLog::create([
            'user_id'    => $project->user_id,
            'event_type' => 'video_render',
            'message'    => "Rendering video project \"{$project->name}\"",
            'status'     => 'running',
            'started_at' => now(),
        ]);

        $tmpDir = sys_get_temp_dir() . '/vprender_' . $project->id;
        @mkdir($tmpDir, 0700, true);

        try {
            $clipsById = VideoProjectClip::where('video_project_id', $project->id)->get()->keyBy('id');

            $segmentPaths  = [];
            $totalDuration = 0.0;

            foreach ($entries->values() as $i => $entry) {
                $clip = $clipsById->get($entry['clip_id'] ?? null);
                if (! $clip || ! $clip->storage_path || $clip->status !== 'ready') {
                    throw new \RuntimeException(
                        'Timeline entry ' . ($i + 1) . " references a clip that isn't ready (removed, still processing, or failed) — fix the timeline in the studio before rendering."
                    );
                }
                if (! Storage::disk('video')->exists($clip->storage_path)) {
                    throw new \RuntimeException('Timeline entry ' . ($i + 1) . "'s clip file is missing or has expired.");
                }

                $trimIn  = max(0.0, (float) ($entry['trim_in'] ?? 0));
                $trimOut = (float) ($entry['trim_out'] ?? 0);
                $dur     = $trimOut - $trimIn;
                if ($dur <= 0) {
                    throw new \RuntimeException('Timeline entry ' . ($i + 1) . ' has an invalid trim range (' . $trimIn . 's–' . $trimOut . 's).');
                }

                $srcPath = $tmpDir . "/src_{$i}.mp4";
                $srcStream = Storage::disk('video')->readStream($clip->storage_path);
                if (! $srcStream) {
                    throw new \RuntimeException('Timeline entry ' . ($i + 1) . "'s clip file could not be read from storage.");
                }
                file_put_contents($srcPath, stream_get_contents($srcStream));
                fclose($srcStream);

                // Trim + normalize to one consistent spec in a single
                // pass — see class docblock for why this happens per
                // segment rather than leaving it to the final concat.
                $segPath = $tmpDir . "/seg_{$i}.mp4";
                $this->runFfmpeg([
                    'ffmpeg', '-y',
                    '-ss', (string) $trimIn, '-i', $srcPath, '-t', (string) $dur,
                    '-vf', 'scale=' . self::OUT_WIDTH . ':' . self::OUT_HEIGHT . ':force_original_aspect_ratio=decrease,pad='
                        . self::OUT_WIDTH . ':' . self::OUT_HEIGHT . ':(ow-iw)/2:(oh-ih)/2,setsar=1',
                    '-r', (string) self::OUT_FPS,
                    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac', '-ar', '48000', '-b:a', '192k', '-ac', '2',
                    $segPath,
                ], 'Segment ' . ($i + 1) . ' trim/normalize');

                $segDuration    = $this->probeDuration($segPath) ?: $dur;
                $totalDuration += $segDuration;
                $segmentPaths[] = $segPath;

                @unlink($srcPath); // done with the untrimmed copy — keep tmpDir from ballooning across a long timeline
            }

            $listPath = $tmpDir . '/concat_list.txt';
            file_put_contents($listPath, implode("\n", array_map(
                fn($p) => "file '" . str_replace("'", "'\\''", $p) . "'",
                $segmentPaths
            )));

            $outputPath = $tmpDir . '/output.mp4';
            $this->runFfmpeg([
                'ffmpeg', '-y',
                '-f', 'concat', '-safe', '0', '-i', $listPath,
                '-c', 'copy',
                $outputPath,
            ], 'Final concat');

            $finalDuration = $this->probeDuration($outputPath) ?: $totalDuration;

            $resultPath = 'video/' . $project->user_id . '/projects/' . $project->id . '/render_' . Str::uuid() . '.mp4';
            Storage::disk('video')->put($resultPath, file_get_contents($outputPath));

            $project->update([
                'status'            => 'done',
                'output_video_path' => $resultPath,
                'duration_seconds'  => round($finalDuration, 2),
                'error'             => null,
            ]);
            $this->updateActivityLog($log, 'Render complete', 'done', now());

        } catch (\Throwable $e) {
            Log::warning("RenderVideoProjectJob {$project->id} failed: {$e->getMessage()}");
            // Terminal 'failed', not a revert to 'draft' — unlike
            // FinalizeDubbingJob's revert-to-review (where expensive,
            // quota-charged translation work would otherwise be lost),
            // nothing here is quota-charged and timeline_json is
            // completely untouched, so 'failed' (an explicit state this
            // table's own enum already has) is the right terminal state;
            // the user just fixes whatever the error says and hits
            // Render again from the same timeline.
            $project->update([
                'status' => 'failed',
                'error'  => $this->truncate($e->getMessage(), 500),
            ]);
            $this->updateActivityLog($log, 'Render failed: ' . $e->getMessage(), 'failed', now());
        } finally {
            $this->rrmdir($tmpDir);
        }
    }

    public function failed(\Throwable $exception): void
    {
        $project = VideoProject::find($this->videoProjectId);
        if ($project && $project->status === 'rendering') {
            $project->update([
                'status' => 'failed',
                'error'  => $this->truncate($exception->getMessage(), 500),
            ]);
        }
    }
}
