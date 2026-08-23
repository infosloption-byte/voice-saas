<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Task #6a (Video Studio) — the media bin: every clip a user has uploaded
 * (or generated via dubbing) into a video_project's working set, whether
 * or not it's currently placed on the timeline.
 *
 * `kind` + `parent_clip_id` + `dubbing_job_id` model dubbing as a clip
 * *variant* rather than a separate resource: when a "Dub this clip"
 * operation finishes, its output lands here as a new row with
 * kind='dubbed', parent_clip_id pointing at the source clip, and
 * dubbing_job_id pointing at the existing DubbingJob that produced it
 * (so the existing segment editor / re-run / retry flow keeps working
 * completely unchanged — this table only ever *links* to that pipeline,
 * never re-implements it).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('video_project_clips', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('video_project_id')->constrained('video_projects')->cascadeOnDelete();

            $table->enum('kind', ['source', 'dubbed'])->default('source');

            // Self-referencing: null for an originally-uploaded clip,
            // set to the source clip's id for a dubbed variant produced
            // from it. No FK constraint on itself needed for cascade
            // correctness here — nulled on delete is enough, a dangling
            // variant with no parent just falls back to standalone.
            $table->uuid('parent_clip_id')->nullable();
            $table->foreign('parent_clip_id')->references('id')->on('video_project_clips')->nullOnDelete();

            // Links to the existing, unmodified dubbing pipeline. Nullable
            // because a plain uploaded (non-dubbed) clip has none.
            $table->uuid('dubbing_job_id')->nullable();
            $table->foreign('dubbing_job_id')->references('id')->on('video_dubbing_jobs')->nullOnDelete();

            $table->string('original_filename', 255)->nullable();
            $table->string('storage_path', 500); // on the "video" disk, same convention as video_dubbing_jobs
            $table->decimal('duration_seconds', 8, 2)->nullable();

            $table->enum('status', [
                'ready', 'processing', 'failed',
            ])->default('ready');

            $table->timestamps();

            $table->index(['video_project_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('video_project_clips');
    }
};
