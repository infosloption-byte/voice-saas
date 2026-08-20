<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Task #6 (Video dubbing MVP) — tracks one row per dubbing job.
 *
 * Unlike bulk synthesis (which reuses the generic activity_logs table),
 * dubbing gets its own table because:
 *  - the frontend needs to poll a specific job by id (activity_logs has no
 *    stable id contract for that — it's a feed, not a job record)
 *  - progress is meaningfully multi-stage (transcribing/translating/
 *    synthesizing/muxing), which activity_logs' running/done/failed enum
 *    can't express, and the stage itself is useful debugging signal
 *  - the result is a stored file (video path) with its own lifecycle,
 *    which activity_logs was never meant to hold
 *
 * activity_log_id is still recorded (nullable) so a dubbing job also shows
 * up in the existing account-activity feed, consistent with every other
 * long-running job in the app.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('video_dubbing_jobs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('activity_log_id')->nullable()
                ->constrained('activity_logs')->nullOnDelete();

            $table->string('voice_profile_id', 100);
            $table->string('source_language', 10)->nullable();
            $table->string('target_language', 10);

            $table->enum('status', [
                'queued', 'transcribing', 'translating',
                'synthesizing', 'muxing', 'done', 'failed',
            ])->default('queued');
            $table->unsignedTinyInteger('progress')->default(0); // 0-100
            $table->text('error')->nullable();

            // Segment count / overflow count are cheap diagnostics: if a
            // deploy suddenly shows a spike in segment_overflow_count across
            // jobs, that's the signal the atempo-stretch ceiling (see
            // VideoDubbingJob::MAX_STRETCH_RATIO) is being hit too often and
            // the timing-mismatch handling needs revisiting.
            $table->unsignedInteger('segment_count')->nullable();
            $table->unsignedInteger('segment_overflow_count')->default(0);

            $table->string('source_video_path', 500);   // original upload, on the "video" disk
            $table->string('result_video_path', 500)->nullable(); // dubbed output, on the "video" disk
            $table->decimal('duration_seconds', 8, 2)->nullable();

            $table->timestamp('started_at')->nullable();
            $table->timestamp('ended_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'created_at']);
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('video_dubbing_jobs');
    }
};
