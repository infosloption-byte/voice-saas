<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Task #6a (Video Studio) — the parent entity for the new video-editing
 * feature. Deliberately parallel to `projects` (the existing audio
 * workspace): a user creates a video_project, adds clips to its media bin
 * (video_project_clips), and composes an ordered `timeline_json` from
 * those clips into one deliverable output video.
 *
 * Video dubbing is NOT being rebuilt here — `video_dubbing_jobs` /
 * `dubbing_segments` and their pipeline stay exactly as they are.
 * Dubbing becomes one operation a user can run *on a clip inside a
 * project's media bin* (see video_project_clips.dubbing_job_id), rather
 * than a standalone top-level thing. See docs/ENHANCEMENT_TASKS.md task
 * #6a for the full phased plan.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('video_projects', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            $table->string('name', 255);

            // Ordered array of { clip_id, trim_in, trim_out, variant }
            // composing the final output — same lightweight-JSON-column
            // pattern `projects.timeline_clips` already uses, not a
            // separate normalized table. variant is 'source' | 'dubbed'.
            $table->json('timeline_json')->nullable();

            $table->enum('status', [
                'draft', 'rendering', 'done', 'failed',
            ])->default('draft');

            $table->string('output_video_path', 500)->nullable(); // rendered result, on the "video" disk
            $table->decimal('duration_seconds', 8, 2)->nullable(); // sum of timeline_json trims, cached
            $table->text('error')->nullable();

            $table->timestamps();

            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('video_projects');
    }
};
