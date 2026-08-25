<?php

namespace App\Console\Commands;

use App\Models\DubbingJob;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Task #6 follow-up — "Storage lifecycle for dubbed videos", flagged as a
 * known gap since the original Video dubbing MVP write-up (see task #6 in
 * docs/ENHANCEMENT_TASKS.md: "audio has AUDIO_PRUNE_DAYS; video has no
 * equivalent"). Shape mirrors PruneAudio, adapted for two real differences
 * between the two storage models:
 *
 *  - Audio prunes per-Script (one file per record, no workflow state).
 *    Video prunes per-DubbingJob, and a job has a real in-progress
 *    lifecycle (queued/transcribing/.../ready_for_review) — only *terminal*
 *    jobs ('done'/'failed') are eligible. A job sitting at
 *    'ready_for_review' is mid-workflow waiting on the user to edit/finalize,
 *    not idle storage; pruning its source video out from under a pending
 *    review would break that flow outright, not just lose a stale file.
 *
 *  - PruneAudio nulls the DB column (audio_url) once the file is gone, so
 *    "no file" and "never had one" collapse to the same state. Video
 *    deliberately does NOT null source_video_path/result_video_path here:
 *    every existing read path — VideoDubbingController::result()/source()
 *    (410 "missing or has expired"), thumbnails()/thumbnailSprite(), and
 *    index()'s has_source/has_result flags — already calls
 *    Storage::disk('video')->exists($path) before trusting a path column,
 *    so a stale-but-present path on an otherwise-intact job row already
 *    surfaces as a clean "expired" result with zero schema change. Nulling
 *    the columns would only lose the (harmless, occasionally useful for
 *    support/debugging) record of what the path used to be.
 */
class PruneVideo extends Command
{
    protected $signature = 'video:prune
        {--days=90 : Delete source/result video files for jobs finished more than this many days ago}';

    protected $description = 'Delete stored source/result video files (and cached thumbnail sprites) for finished dubbing jobs older than N days';

    public function handle(): int
    {
        $days   = (int) $this->option('days');
        $cutoff = now()->subDays($days);

        $jobs = DubbingJob::whereIn('status', ['done', 'failed'])
            ->where('updated_at', '<', $cutoff)
            ->where(function ($query) {
                $query->whereNotNull('source_video_path')
                    ->orWhereNotNull('result_video_path');
            })
            ->get();

        if ($jobs->isEmpty()) {
            $this->info("No dubbed video files older than {$days} days.");
            return 0;
        }

        $disk = Storage::disk('video');
        $deletedFiles = 0;
        $touchedJobs  = 0;

        foreach ($jobs as $job) {
            // Sprite path duplicates VideoDubbingController::thumbnailSpritePath() —
            // that method isn't reusable from here (it's private, and pulling it
            // into a shared helper for one caller isn't worth the indirection),
            // so kept in sync manually. If that path pattern ever changes, this
            // needs updating too.
            $paths = array_filter([
                $job->source_video_path,
                $job->result_video_path,
                'video/' . $job->user_id . '/' . $job->id . '_sprite.jpg',
            ]);

            $jobHadDeletion = false;
            foreach ($paths as $path) {
                if ($disk->exists($path)) {
                    $disk->delete($path);
                    $deletedFiles++;
                    $jobHadDeletion = true;
                }
            }

            if ($jobHadDeletion) {
                $touchedJobs++;
            }
        }

        $this->info("Pruned {$deletedFiles} video file(s) across {$touchedJobs} job(s) older than {$days} days.");

        return 0;
    }
}
